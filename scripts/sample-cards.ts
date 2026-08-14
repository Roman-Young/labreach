export {} // module scope
// GATE 6 of the ingest doctrine (skills/labreach-ingest.md): product-eyes QA. Renders N random
// live labs EXACTLY as the digest surfaces them (lib/rag/digest.ts fields) into sample-cards.md
// for adversarial human review. Pipeline metrics (verbatim %, embed coverage) all passed wave-1
// while the product was wrong — only reading the cards AS A STUDENT caught the directory pages,
// stranger papers, and MDs. Run after EVERY bulk pass; 30 minutes here beats days of remediation.
//
//   npx tsx scripts/sample-cards.ts [--n 10] [--seed <int>]
process.loadEnvFile('.env.local')

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const nIdx = process.argv.indexOf('--n')
  const n = nIdx >= 0 ? Number(process.argv[nIdx + 1]) : 10
  const sIdx = process.argv.indexOf('--seed')
  const seed = sIdx >= 0 ? Number(process.argv[sIdx + 1]) : null
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  if (seed !== null) await sql.query(`SELECT setseed($1)`, [Math.max(-1, Math.min(1, seed))])

  const labs = rows(await sql.query(
    `SELECT lab_url, lab_name, pi_name, pi_email, department, data_modality, recruiting,
            recruiting_evidence, plain_summary, trajectory, apply_info, research_areas, url_status
     FROM lab_profiles WHERE status='done' ORDER BY random() LIMIT ${n}`,
  ))

  const out: string[] = []
  out.push(`# Sample cards — product-eyes QA (${new Date().toISOString().slice(0, 10)}, n=${labs.length})`)
  out.push('')
  out.push(`Review each card AS A STUDENT deciding whether to email this lab. For each, answer:`)
  out.push(`- [ ] Right person? (papers/findings actually this PI's — not a same-surname stranger)`)
  out.push(`- [ ] Real, joinable lab? (not a clinician/emeritus; site is the lab's own)`)
  out.push(`- [ ] Email plausible? (name-matched, personal, not a shared mailbox)`)
  out.push(`- [ ] Summary/overview grounded? (matches the findings; no invented specifics)`)
  out.push(`- [ ] Would you trust this card enough to send a cold email from it?`)
  out.push('')

  for (const [i, l] of labs.entries()) {
    const ai = l.apply_info ? (typeof l.apply_info === 'string' ? JSON.parse(l.apply_info as string) : l.apply_info) as Record<string, string> : null
    const findings = rows(await sql.query(
      `SELECT type, title, year, content, anchor_quote, source_id FROM lab_chunks
       WHERE lab_url=$1 AND quarantined=false AND type IN ('paper','overview','future_direction')
       ORDER BY (type='overview') DESC, year DESC NULLS LAST LIMIT 5`,
      [l.lab_url],
    ))
    out.push(`---`)
    out.push(`## ${i + 1}. ${l.lab_name ?? '(no lab_name)'} — ${l.pi_name}`)
    out.push(`**${l.department ?? '?'}** · ${l.data_modality ?? '?'} · recruiting: **${l.recruiting ?? 'unknown'}**${l.recruiting_evidence ? ` — "${l.recruiting_evidence}"` : ''}`)
    out.push(`email: \`${l.pi_email ?? 'MISSING'}\` · url(${l.url_status ?? '?'}): ${l.lab_url}`)
    out.push('')
    out.push(`**Summary:** ${l.plain_summary ?? '∅ MISSING'}`)
    if (l.trajectory) out.push(`\n**Trajectory:** ${l.trajectory}`)
    if (ai) out.push(`\n**How to apply:** ${ai.instructions} — "${ai.quote}"${ai.url ? ` (${ai.url})` : ''}`)
    out.push(`\n**Findings shown to the student:**`)
    for (const f of findings) {
      const label = f.type === 'overview' ? 'OVERVIEW' : f.type === 'future_direction' ? 'FUTURE' : `PAPER${f.year ? ` ${f.year}` : ''}`
      out.push(`- [${label}] ${f.title ? `**${String(f.title).slice(0, 90)}** — ` : ''}${String(f.content).slice(0, 260)}${String(f.content).length > 260 ? '…' : ''}`)
      if (f.source_id) out.push(`  · source: \`${f.source_id}\``)
    }
    out.push('')
  }

  const fs = await import('fs')
  fs.writeFileSync('sample-cards.md', out.join('\n'))
  console.log(`✓ wrote sample-cards.md (${labs.length} cards). Read it as the student. Every unchecked box is a bug.`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
