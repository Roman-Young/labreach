// Trajectory enrichment pass over CACHED chunks (no Firecrawl, no re-gather, no site pages):
// per done lab, one bounded gemini-2.5-flash call over its ~6 most-recent paper chunks plus any
// future_direction chunk, producing
//   trajectory — 2-3 plain-language sentences (~50-80 words) on WHERE the lab's work is HEADING:
//   the direction synthesized from recent papers + the lab's own stated future-work lines, and
//   what it could lead to (potential applications/breakthroughs, always framed as potential,
//   never as achieved fact). Renders under a heading on the lab card, so it never starts with
//   "This lab". If the material shows no discernible direction the model returns "" and we store
//   NULL (such labs will be revisited on a re-run — acceptable: they're the rare thin-input case).
//
//   npx tsx scripts/enrich-trajectory.ts [--limit N] [--concurrency C=3]
//
// Resumable: only touches labs with status='done' AND trajectory IS NULL. Input is already
// LLM-distilled, grounded chunk text from ingestion (not raw pages), so bundles are small —
// cost is well under enrich.ts's ~$0.003-0.006/lab.
process.loadEnvFile('.env.local')
import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai'

const SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: { trajectory: { type: SchemaType.STRING } as Schema },
  required: ['trajectory'],
} as Schema

const INSTRUCTION = `You will read summaries of a research lab's most recent published papers, and (if present) the lab's own stated future directions. Produce JSON with one field, "trajectory": 2 to 3 sentences, about 50-80 words, on WHERE THIS LAB'S WORK IS HEADING — the big picture.

Requirements:
1. Synthesize the direction from the recent papers and the lab's own stated future-work lines. Ground every claim ONLY in the material given — do not invent or embellish anything.
2. Connect the direction to what it could lead to — specific potential medical or scientific breakthroughs or applications — ALWAYS framed as potential ("could", "aims to", "a step toward"), NEVER as achieved fact.
3. Write in plain language a first-year biology student understands; gloss any technical term or acronym in plain words.
4. No hype words like "groundbreaking" or "revolutionary". Do not name the PI. Do NOT start with "This lab" — the text renders under a heading, so vary the opening (e.g. "The work is moving toward…", "Their recent papers point at…", "Building on…").
5. If the material genuinely shows no discernible direction, return an empty string for "trajectory".

MATERIAL:
`

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const { requireSql } = await import('../lib/db')
  const { withRetry } = await import('../lib/retry')
  const sql = requireSql()
  const args = process.argv.slice(2)
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : undefined }
  const limit = flag('limit')
  const concurrency = flag('concurrency') ?? 3

  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      maxOutputTokens: 300,
      thinkingConfig: { thinkingBudget: 0 },
    } as unknown as Record<string, unknown>,
  })

  await sql.query(`ALTER TABLE lab_profiles ADD COLUMN IF NOT EXISTS trajectory text`)

  const labs = asRows(await sql.query(
    `SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' AND trajectory IS NULL ORDER BY lab_url ${limit ? `LIMIT ${limit}` : ''}`,
  ))
  console.log(`trajectory pass over ${labs.length} labs (concurrency ${concurrency})...`)

  let done = 0, empty = 0, skipped = 0, failed = 0
  let idx = 0
  async function worker() {
    while (idx < labs.length) {
      const lab = labs[idx++]
      try {
        // Lab's own stated future-work lines first (the strongest trajectory signal), then the
        // ~6 most-recent papers — all already LLM-distilled and grounded from ingestion.
        const futures = asRows(await sql.query(
          `SELECT type, title, year, content FROM lab_chunks WHERE lab_url=$1 AND type='future_direction'`,
          [lab.lab_url],
        ))
        const papers = asRows(await sql.query(
          `SELECT type, title, year, content FROM lab_chunks
             WHERE lab_url=$1 AND type='paper'
             ORDER BY year DESC NULLS LAST LIMIT 6`,
          [lab.lab_url],
        ))
        let bundle = ''
        for (const c of [...futures, ...papers]) {
          const label = c.type === 'future_direction' ? 'FUTURE DIRECTION' : `PAPER${c.year ? ` (${c.year})` : ''}`
          bundle += `\n[${label}] ${c.title ? `${c.title} — ` : ''}${c.content}\n`
        }
        if (!bundle.trim()) { skipped++; console.log(`  ~ ${lab.pi_name} — no paper/future_direction chunks, skipped`); continue }

        const out = await withRetry(async () => {
          const res = await model.generateContent(`${INSTRUCTION}${bundle}`)
          const u = (res.response as { usageMetadata?: Record<string, number> }).usageMetadata
          if (u) console.log(`[usage] in=${u.promptTokenCount ?? 0} out=${u.candidatesTokenCount ?? 0} thoughts=${u.thoughtsTokenCount ?? 0}`)
          return JSON.parse(res.response.text()) as { trajectory?: string }
        }, { attempts: 2 })

        const trajectory = (out.trajectory ?? '').trim() || null
        await sql.query(`UPDATE lab_profiles SET trajectory=$1 WHERE lab_url=$2`, [trajectory, lab.lab_url])
        done++
        if (!trajectory) empty++
        console.log(`  ${trajectory ? '✓' : '·'} [${done + skipped + failed}/${labs.length}] ${lab.pi_name}${trajectory ? '' : ' — empty (no discernible direction)'}`)
      } catch (e) {
        failed++
        console.log(`  ✗ ${lab.pi_name} — ${(e as Error).message.slice(0, 80)}`)
      }
    }
  }
  const t0 = Date.now()
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  console.log(`\ndone: ${done} ok (${empty} empty→NULL), ${skipped} skipped (no chunks), ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
