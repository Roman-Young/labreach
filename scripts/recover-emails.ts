export {} // module scope (isolates top-level `main` from sibling CLI scripts)
// Recover PI emails ALREADY present in cached pages (no Firecrawl). TWO HARD GATES on any write —
// nothing is stored unless BOTH pass:
//   Gate A (grounded): the address appears VERBATIM in the cached page (no fabrication possible).
//   Gate B (name-consistent): the local-part matches the PI's name (kills co-author/support noise
//     like ctri-support@ or a different faculty's address). Common surnames (Zhang, Kim, …) require
//     the FULL first name, not just an initial, to disambiguate.
// Only plain, grounded, strongly name-matched addresses auto-write. Obfuscated or weak matches are
// FLAGGED for review, never written. Dry-run by default.
//
//   npx tsx scripts/recover-emails.ts            → dry run (prints proposals, writes nothing)
//   npx tsx scripts/recover-emails.ts --execute  → applies ONLY the strong, grounded, name-matched
process.loadEnvFile('.env.local')

import { nameParts, localMatchesPi, GENERIC, EMAIL_RE, OBF_RE, type PiName } from '../lib/name-match'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

// Gate B (shared logic in lib/name-match.ts) with human-readable reasons for the review output.
function nameMatch(email: string, pi: PiName): { strong: boolean; reason: string } {
  if (GENERIC.test(email)) return { strong: false, reason: 'generic mailbox' }
  if (!pi.lasts.length) return { strong: false, reason: 'no usable PI last name' }
  const local = email.split('@')[0].toLowerCase()
  if (!pi.lasts.some((l) => local.includes(l)))
    return { strong: false, reason: `local-part lacks last name "${pi.lasts.join('/')}"` }
  return localMatchesPi(local, pi)
    ? { strong: true, reason: `local-part matches PI (${pi.first} ${pi.lasts.join(' ')})` }
    : { strong: false, reason: 'surname present but not identifying (common surname or no first-name signal) — REVIEW' }
}

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const execute = process.argv.includes('--execute')
  console.log(execute ? '=== EXECUTING (grounded + strong name-match only) ===\n' : '=== DRY RUN (pass --execute to apply) ===\n')

  const labs = rows(await sql.query(
    `SELECT lab_url, pi_name, raw_pages FROM lab_profiles WHERE status='done' AND (pi_email IS NULL OR pi_email='')`,
  ))

  const write: Array<{ url: string; pi: string; email: string; reason: string }> = []
  const review: Array<{ pi: string; email: string; reason: string; obf: boolean }> = []
  let noEmail = 0

  for (const l of labs) {
    const obj = (typeof l.raw_pages === 'string' ? JSON.parse(l.raw_pages as string) : l.raw_pages) || {}
    const text = Object.values(obj as Record<string, unknown>).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n')
    const pi = nameParts(l.pi_name as string)

    const plain = new Set<string>()
    for (const m of text.matchAll(EMAIL_RE)) plain.add(m[0].toLowerCase())
    const obfs = new Set<string>()
    for (const m of text.matchAll(OBF_RE)) obfs.add(`${m[1]}@${m[2]}.${m[3]}`.toLowerCase())
    if (!plain.size && !obfs.size) {
      noEmail++
      continue
    }

    // best plain, strongly-matched address → auto-write; otherwise collect the closest for review
    const plainStrong = [...plain].map((e) => ({ e, ...nameMatch(e, pi) })).filter((x) => x.strong)
    if (plainStrong.length) {
      write.push({ url: l.lab_url as string, pi: l.pi_name as string, email: plainStrong[0].e, reason: plainStrong[0].reason })
    } else {
      // pick something to eyeball: a name-containing address if any, else the first non-generic
      const cand =
        [...plain, ...obfs].find((e) => pi.lasts.some((l) => e.split('@')[0].includes(l))) ??
        [...plain, ...obfs].find((e) => !GENERIC.test(e)) ??
        [...plain, ...obfs][0]
      if (cand) review.push({ pi: l.pi_name as string, email: cand, reason: nameMatch(cand, pi).reason, obf: !plain.has(cand) })
    }
  }

  console.log(`WILL WRITE — grounded + strong name-match (${write.length}):`)
  for (const w of write) console.log(`  ${w.pi}\n     → ${w.email}   (${w.reason})`)
  console.log(`\nREVIEW ONLY — not written, hand off to the contact-hunt (${review.length}):`)
  for (const r of review) console.log(`  ${r.pi} → ${r.email}${r.obf ? ' [obfuscated]' : ''}   (${r.reason})`)
  console.log(`\nno email of any form in cache: ${noEmail}  (need a fresh contact-page fetch)`)

  if (execute) {
    for (const w of write) {
      await sql.query(
        `UPDATE lab_profiles SET pi_email = $2, pi_email_source = 'scrape', pi_email_verified_at = now()
         WHERE lab_url = $1 AND (pi_email IS NULL OR pi_email='')`,
        [w.url, w.email],
      )
    }
    console.log(`\n✓ wrote ${write.length} grounded, name-matched emails.`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
