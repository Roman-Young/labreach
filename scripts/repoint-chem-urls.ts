export {} // module scope
// Auto-repoint the chemistry.ucsd.edu restructure: the department dropped the `/profiles/` path
// segment, so /faculty/profiles/<slug>.html → /faculty/<slug>.html. Each candidate is VERIFIED
// before writing: we fetch the new URL and require the PI's surname to appear in the prerendered
// HTML (the site is a SPA that soft-200s every path, so surname-presence is the real liveness test).
// The write repoints lab_profiles.lab_url AND lab_chunks.lab_url in ONE data-modifying CTE, so the
// FK (ON UPDATE NO ACTION) stays consistent at statement end. Reversible: old→new logged.
//   npx tsx scripts/repoint-chem-urls.ts           → dry run (verify + report, no writes)
//   npx tsx scripts/repoint-chem-urls.ts --execute → repoint verified ones
process.loadEnvFile('.env.local')



const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } })
    return res.ok ? await res.text() : ''
  } catch {
    return ''
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  const execute = process.argv.includes('--execute')
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const labs = rows(await sql.query(
    `SELECT lab_url, pi_name FROM lab_profiles
     WHERE status='done' AND url_status='dead' AND lab_url LIKE 'https://chemistry.ucsd.edu/faculty/profiles/%'
     ORDER BY lab_url`,
  ))
  console.log(`${labs.length} dead chemistry URLs to try repointing (${execute ? 'EXECUTE' : 'DRY'})...\n`)

  const verified: Array<{ old: string; new: string; pi: string }> = []
  const failed: Array<{ old: string; pi: string; note: string }> = []

  for (const l of labs) {
    const oldUrl = l.lab_url as string
    const newUrl = oldUrl.replace('/faculty/profiles/', '/faculty/')
    // The slug is `surname_first[_mi]`; use its longest name token as the liveness probe — more
    // reliable than nameParts for short surnames (e.g. "Li"), which the shell soft-200 lacks.
    const slug = decodeURIComponent(new URL(oldUrl).pathname.split('/').pop()!.replace(/\.html$/, ''))
    const probe = slug.split(/_+/).filter((t) => t.length >= 4).sort((a, b) => b.length - a.length)[0]
    const html = await fetchText(newUrl)
    const hits = probe ? (html.toLowerCase().match(new RegExp(probe, 'g')) || []).length : 0
    if (html && probe && hits >= 2) {
      verified.push({ old: oldUrl, new: newUrl, pi: l.pi_name as string })
    } else {
      failed.push({ old: oldUrl, pi: l.pi_name as string, note: html ? `probe "${probe}" only ${hits} hits` : 'fetch failed' })
    }
  }

  console.log(`VERIFIED repoints (${verified.length}):`)
  for (const v of verified) console.log(`  ${v.pi}\n     ${v.old}\n  →  ${v.new}`)
  console.log(`\nUNVERIFIED — left dead, hand to Roman (${failed.length}):`)
  for (const f of failed) console.log(`  ${f.pi}  [${f.note}]\n     ${f.old}`)

  if (execute) {
    for (const v of verified) {
      await sql.query(
        `WITH p AS (
           UPDATE lab_profiles SET lab_url = $2, url_status = 'ok', url_checked_at = now()
           WHERE lab_url = $1 RETURNING 1
         )
         UPDATE lab_chunks SET lab_url = $2 WHERE lab_url = $1`,
        [v.old, v.new],
      )
    }
    const fs = await import('fs')
    fs.writeFileSync(
      'repoint-log-chem.txt',
      [`Chemistry URL repoints — ${new Date().toISOString().slice(0, 10)}`, '', ...verified.map((v) => `${v.old}  →  ${v.new}`)].join('\n'),
    )
    console.log(`\n✓ repointed ${verified.length} labs (profiles + chunks); logged to repoint-log-chem.txt`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
