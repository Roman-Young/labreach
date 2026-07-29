// Head-to-head quality audit: v1 (stored chunks) vs v2 (fresh gather->extract) on
// the SAME labs. Mechanical metrics + a BLIND LLM-judge on connectability, plus a
// v2 summary-vs-source support check. This is the gate before any batch spend.
// Run:  npx tsx scripts/audit.ts [N=8]
process.loadEnvFile('.env.local')

import type { Schema } from '@google/generative-ai'

type Chunk = { text: string; quote: string; source: string; system: 'v1' | 'v2' }

async function main() {
  const { neon } = await import('@neondatabase/serverless')
  const { gatherLab } = await import('../lib/rag/gather')
  const { extractLabV2 } = await import('../lib/rag/extract2')
  const { mapWithConcurrency } = await import('../lib/pool')
  const { GoogleGenerativeAI, SchemaType } = await import('@google/generative-ai')

  const sql = neon(process.env.DATABASE_URL as string)
  const rows = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : (r as { rows?: [] }).rows ?? [])
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const pct = (xs: number[]) => `${Math.round(avg(xs) * 100)}%`

  const N = Number(process.argv[2] || 8)
  const labs = rows(await sql.query(
    `SELECT p.lab_url, p.pi_name, p.raw_pages FROM lab_profiles p
     WHERE p.status='done' AND p.pi_name IS NOT NULL AND p.raw_pages IS NOT NULL
       AND EXISTS (SELECT 1 FROM lab_chunks c WHERE c.lab_url=p.lab_url)
     ORDER BY random() LIMIT $1`, [N],
  ))
  console.log(`Auditing ${labs.length} labs (v1 stored vs v2 fresh)...\n`)

  const m = {
    v1: { fid: [] as number[], rich: [] as number[], trace: [] as number[] },
    v2: { fid: [] as number[], rich: [] as number[], trace: [] as number[] },
  }
  const judgePool: Chunk[] = []
  const v2SupportPool: { summary: string; source: string }[] = []

  await mapWithConcurrency(labs, 3, async (lab) => {
    const url = String(lab.lab_url)
    const pi = lab.pi_name as string
    // v1 — stored
    const v1c = rows(await sql.query('SELECT content, source FROM lab_chunks WHERE lab_url=$1', [url]))
    const v1raw = norm(Object.values((typeof lab.raw_pages === 'string' ? JSON.parse(lab.raw_pages) : lab.raw_pages) || {}).join(' '))
    // v2 — fresh (in memory, not stored)
    const g = await gatherLab(url, pi)
    const { chunks: v2c } = await extractLabV2(g)
    const v2raw = norm(Object.values(g.pages).join(' '))

    const fid = (chunks: { q: string }[], raw: string) => {
      let ok = 0, n = 0
      for (const c of chunks) { const q = norm(c.q); if (q.length < 20) continue; n++; if (raw.includes(q.slice(0, 60))) ok++ }
      return n ? ok / n : 0
    }
    m.v1.fid.push(fid(v1c.map((c) => ({ q: String(c.content) })), v1raw))
    m.v2.fid.push(fid(v2c.map((c) => ({ q: c.anchorQuote || '' })), v2raw))
    m.v1.rich.push(avg(v1c.map((c) => String(c.content).length)))
    m.v2.rich.push(avg(v2c.map((c) => c.content.length)))
    m.v1.trace.push(avg(v1c.map((c) => (/(pmid|doi|pmc\d)/i.test(String(c.source)) ? 1 : 0))))
    m.v2.trace.push(avg(v2c.map((c) => (/^(doi:|pmid:)/.test(c.sourceId || '') ? 1 : 0))))

    // sample chunks for the blind connectability judge (up to 3 each)
    for (const c of v1c.slice(0, 3)) judgePool.push({ text: String(c.content), quote: String(c.content), source: String(c.source), system: 'v1' })
    for (const c of v2c.filter((x) => x.kind === 'paper').slice(0, 3)) {
      judgePool.push({ text: c.content, quote: c.anchorQuote || '', source: c.sourceId || '', system: 'v2' })
      // support = summary vs the paper's FULL source text (abstract/full text), not one quote.
      const idPart = (c.sourceId || '').replace(/^(doi:|pmid:)/, '')
      let src = ''
      for (const [k, v] of Object.entries(g.pages)) { if (idPart && k.includes(idPart)) src += String(v) + '\n' }
      if (!src) src = Object.values(g.pages).join('\n').slice(0, 8000)
      v2SupportPool.push({ summary: c.content, source: src.slice(0, 6000) })
    }
    process.stdout.write('.')
  })
  console.log('\n')

  // ── Blind connectability judge (does not see v1/v2 label) ──
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY as string)
  const shuffled = judgePool.map((c, i) => ({ ...c, i })).sort(() => Math.random() - 0.5)
  const judgeModel = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { i: { type: SchemaType.INTEGER }, score: { type: SchemaType.INTEGER } }, required: ['i', 'score'] } } as unknown as Schema,
    },
  })
  const scoreByIdx = new Map<number, number>()
  for (let b = 0; b < shuffled.length; b += 12) {
    const batch = shuffled.slice(b, b + 12)
    const prompt = `You are judging research-lab database entries for a tool that helps undergraduates cold-email labs. For EACH numbered entry, score 1-5: could a student form a SPECIFIC, genuine research hook to email this lab from this entry alone? (1=generic/title-only/useless, 5=specific finding a student could clearly reference). Return {i, score} for each.\n\n${batch.map((c) => `[${c.i}] ${c.text.slice(0, 400)}`).join('\n\n')}`
    try {
      const res = await judgeModel.generateContent(prompt)
      for (const r of JSON.parse(res.response.text()) as { i: number; score: number }[]) scoreByIdx.set(r.i, r.score)
    } catch { /* skip batch */ }
  }
  const connV1: number[] = [], connV2: number[] = []
  for (const c of shuffled) { const s = scoreByIdx.get(c.i); if (s == null) continue; (c.system === 'v1' ? connV1 : connV2).push(s) }

  // ── v2 summary-vs-source support (does the CLAIM hold, not just the quote) ──
  let support = 0, supportN = 0
  for (let b = 0; b < v2SupportPool.length; b += 12) {
    const batch = v2SupportPool.slice(b, b + 12)
    const prompt = `For each item, is EVERY factual claim in the SUMMARY supported by the SOURCE text (no invented/unsupported claims)? Return {i, ok} (ok=true if fully supported).\n\n${batch.map((x, j) => `[${j}] SUMMARY: ${x.summary.slice(0, 400)}\n SOURCE: ${x.source.slice(0, 3500)}`).join('\n\n')}`
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { i: { type: SchemaType.INTEGER }, ok: { type: SchemaType.BOOLEAN } }, required: ['i', 'ok'] } } as unknown as Schema } })
      const res = await model.generateContent(prompt)
      for (const r of JSON.parse(res.response.text()) as { ok: boolean }[]) { supportN++; if (r.ok) support++ }
    } catch { /* skip */ }
  }

  // ── Report ──
  const row = (label: string, v1: string, v2: string) => console.log(`  ${label.padEnd(28)} v1: ${String(v1).padStart(7)}   v2: ${String(v2).padStart(7)}`)
  console.log('══ HEAD-TO-HEAD: v1 vs v2 (same labs) ══')
  row('anchor fidelity', pct(m.v1.fid), pct(m.v2.fid))
  row('mean chunk chars (richness)', String(Math.round(avg(m.v1.rich))), String(Math.round(avg(m.v2.rich))))
  row('traceable source', pct(m.v1.trace), pct(m.v2.trace))
  row('connectability (judge 1-5)', avg(connV1).toFixed(2), avg(connV2).toFixed(2))
  console.log(`\n  v2 summary-supported-by-source: ${supportN ? Math.round(support / supportN * 100) : 0}% (n=${supportN})`)
  console.log(`  judge sample sizes: v1=${connV1.length} v2=${connV2.length}`)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })

export {}
