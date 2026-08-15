export {} // module scope
// WAVE-2 PAPER PIPELINE — STORE stage (SURGICAL: paper layer only). For each gathered lab with a
// Sonnet .papers.json, runs the EXISTING assembleLabV2 grounding guard to produce grounded paper
// chunks, then writes ONLY the paper layer — it must never touch the audited overview chunk, the
// manual/grounded pi_email, department, or school. So instead of storeLabV2 (which DELETEs all
// chunks and upserts the whole profile), this:
//   1. assembleLabV2 → keep kind==='paper' chunks (verbatim-quote grounding enforced in that fn)
//   2. if 0 grounded papers → FAIL LOUD (flag, touch nothing)
//   3. DELETE existing kind='paper' chunks for this lab (idempotent re-run), INSERT the grounded ones
//   4. re-apply the quarantine ledger to the fresh paper rows (known contaminants stay hidden)
//   5. set research_quality, flip status 'profile'->'done', write plain_summary/trajectory
// Overview/email/dept/school are read-only here. Dry-run by default.
//
//   npx tsx scripts/wave2-pub-store.ts [--execute] [--only <slug>]
process.loadEnvFile('.env.local')
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'

const DIR = 'data/wave2-papers'

async function main() {
  const execute = process.argv.includes('--execute')
  const onlyI = process.argv.indexOf('--only'); const only = onlyI >= 0 ? process.argv[onlyI + 1] : null
  const { assembleLabV2 } = await import('../lib/rag/extract2')
  const { requireSql } = await import('../lib/db')
  const sql = execute ? requireSql() : null

  const caches = readdirSync(DIR).filter(f => f.endsWith('.json') && !f.includes('.papers.') && !f.includes('.summary.') && !f.startsWith('_'))
  const flagged: Array<{ slug: string; labUrl: string; reason: string }> = []
  let stored = 0, skipped = 0

  for (const f of caches) {
    const slug = f.replace(/\.json$/, '')
    if (only && slug !== only) continue
    const base = `${DIR}/${slug}`
    if (!existsSync(`${base}.papers.json`)) { skipped++; continue }

    const { g, bundle } = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as { g: import('../lib/rag/gather').GatheredLab; bundle: string }
    const papers = JSON.parse(readFileSync(`${base}.papers.json`, 'utf8')) as { papers: unknown[] }
    let summary: { plain_summary?: string; trajectory?: string } | null = null
    if (existsSync(`${base}.summary.json`)) { try { summary = JSON.parse(readFileSync(`${base}.summary.json`, 'utf8')) } catch { /* left null */ } }

    // Reuse the EXACT grounding guard: assembleLabV2 drops any paper chunk whose anchor_quote isn't
    // verbatim in the bundle. We keep ONLY the paper chunks (overview is preserved in the DB).
    const { chunks } = assembleLabV2(g, bundle, { papers: papers.papers })
    // Belt-and-suspenders 5-year recency floor (also enforced at gather) — never store a paper
    // older than the past 5 years, so "recent" is always truthful even on a re-run of old caches.
    const FLOOR = new Date().getFullYear() - 5
    const paperChunks = chunks.filter(c => c.kind === 'paper' && (c.year ?? 0) >= FLOOR)

    if (!paperChunks.length) {
      flagged.push({ slug, labUrl: g.labUrl, reason: `0 papers survived the grounding guard (of ${papers.papers.length} summarized)` })
      console.log(`  ✗ FLAG ${slug} — 0 grounded papers`)
      continue
    }
    const quality = paperChunks.length >= 3 ? 'good' : 'limited'
    console.log(`  ${execute ? 'STORE' : 'dry'} ${g.labUrl.padEnd(42)} grounded-papers=${paperChunks.length}/${papers.papers.length} quality=${quality} summary=${summary?.plain_summary ? 'y' : 'NO'}`)
    for (const c of paperChunks.slice(0, 3)) console.log(`     • [${c.year ?? '?'}|${c.sourceId ?? 'no-id'}] ${(c.title ?? '').slice(0, 72)}`)

    if (execute && sql) {
      // idempotent: clear prior paper chunks for this lab, then insert the fresh grounded set
      await sql.query(`DELETE FROM lab_chunks WHERE lab_url=$1 AND type='paper'`, [g.labUrl])
      for (const c of paperChunks) {
        await sql.query(
          `INSERT INTO lab_chunks (lab_url, type, title, year, content, anchor_quote, source, source_id, meta)
           VALUES ($1,'paper',$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [g.labUrl, c.title, c.year, c.content, c.anchorQuote, c.sourceLabel, c.sourceId, c.meta ? JSON.stringify(c.meta) : null],
        )
      }
      // re-apply quarantine ledger to the fresh paper rows (a known contaminant stays hidden)
      await sql.query(
        `UPDATE lab_chunks lc SET quarantined=true, quarantine_reason=ql.reason
           FROM quarantine_ledger ql
          WHERE lc.lab_url=$1 AND lc.lab_url=ql.lab_url AND lc.source_id=ql.source_id`, [g.labUrl])
      // paper layer metadata; flip to done; write summary/trajectory when valid — NEVER touch email/overview
      await sql.query(`UPDATE lab_profiles SET research_quality=$2, status='done', last_refreshed=now(), updated_at=now() WHERE lab_url=$1`, [g.labUrl, quality])
      if (summary?.plain_summary && summary.plain_summary.trim().length >= 100) {
        await sql.query(`UPDATE lab_profiles SET plain_summary=$2, trajectory=$3 WHERE lab_url=$1`,
          [g.labUrl, summary.plain_summary.trim(), summary.trajectory?.trim() || null])
      }
      writeFileSync(`${base}.stored`, new Date().toISOString())
      stored++
    }
  }

  writeFileSync(`${DIR}/_store_flagged.json`, JSON.stringify(flagged, null, 1))
  console.log(`\n${execute ? 'stored' : 'would store'}: ${stored} | no-answer-yet: ${skipped} | flagged(0 grounded): ${flagged.length}`)
  if (flagged.length) for (const x of flagged) console.log(`  FLAGGED: ${x.labUrl} — ${x.reason}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
