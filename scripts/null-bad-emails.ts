export {} // module scope
// NULL the stored pi_emails that are provably wrong, so a wrong address never shows. An email is
// "wrong" if ANY holds — each is deterministic and safe (a correct UCSD alias like byl015 trips none):
//   1. DUPLICATE  — the same address is stored on >1 different PI (one email can't be two people).
//   2. OTHER PI   — the local-part strongly name-matches a DIFFERENT PI in our DB (it's their email).
//   3. GENERIC    — a support/shared mailbox (ctri-support@, info@, contact@, …), not a person.
// Correct addresses (name-matches THIS PI, or a cryptic alias matching nobody else) are kept.
// Nulled labs then feed the contact-hunt. Dry-run by default.
//
//   npx tsx scripts/null-bad-emails.ts            → dry run
//   npx tsx scripts/null-bad-emails.ts --execute  → set pi_email = NULL for the wrong ones
process.loadEnvFile('.env.local')

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
const strip = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s,]/g, ' ').replace(/\s+/g, ' ').trim()

function nameParts(pi: string | null): { first: string; last: string } {
  if (!pi) return { first: '', last: '' }
  const s = strip(pi.replace(/[,\s]+(?:ph\.?d\.?|m\.?d\.?|d\.?o\.?|m\.?s\.?|m\.?p\.?h\.?|d\.?d\.?s\.?|sc\.?d\.?|m\.?b\.?a\.?|m\.?b\.?i\.?|fasco|facs|faap|famia)\.?(?=$|[,\s])/gi, ''))
  if (s.includes(',')) {
    const [l, f] = s.split(',')
    return { first: (f || '').trim().split(' ')[0] || '', last: (l || '').trim().split(' ').pop() || '' }
  }
  const toks = s.split(' ').filter(Boolean)
  return { first: toks[0] || '', last: toks[toks.length - 1] || '' }
}
const COMMON = new Set(['zhang', 'li', 'wang', 'chen', 'liu', 'yang', 'huang', 'wu', 'xu', 'sun', 'zhao', 'zhou', 'kim', 'lee', 'park', 'cho', 'choi', 'singh', 'kumar', 'patel', 'shah', 'smith', 'brown', 'jones', 'garcia', 'nguyen', 'tran', 'khan', 'ali', 'das'])
// Generic/support mailboxes — judged by the LOCAL-PART only, never the domain (ferhatay@lji.org is
// a real personal address; contact@lji.org is not). Topic/lab inboxes (phages@, musclelab@) are
// KEPT — they're reachable lab contacts, not wrong.
const GENERIC = /(^|[.-])(info|admin|contact|webmaster|help|support|no-?reply|donotreply|registered|available|found|application|service|online)@/i

// strong: local-part clearly belongs to this person
function strongMatch(local: string, pi: { first: string; last: string }): boolean {
  if (pi.last.length < 3 || !local.includes(pi.last)) return false
  const fullFirst = pi.first.length >= 3 && local.includes(pi.first)
  const initLast = !!pi.first && local.startsWith(pi.first[0])
  if (COMMON.has(pi.last)) return fullFirst
  return fullFirst || initLast
}

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const execute = process.argv.includes('--execute')
  console.log(execute ? '=== EXECUTING (nulling wrong emails) ===\n' : '=== DRY RUN (pass --execute to apply) ===\n')

  const all = rows(await sql.query(`SELECT lab_url, pi_name, pi_email FROM lab_profiles WHERE status='done'`))
  const withEmail = all.filter((l) => l.pi_email && String(l.pi_email).trim())
  const parts = all.map((l) => ({ lab: l, pi: nameParts(l.pi_name as string) }))

  // duplicate emails across distinct labs
  const byEmail = new Map<string, number>()
  for (const l of withEmail) byEmail.set(String(l.pi_email).toLowerCase(), (byEmail.get(String(l.pi_email).toLowerCase()) ?? 0) + 1)

  const bad: Array<{ url: string; pi: string; email: string; why: string }> = []
  for (const l of withEmail) {
    const email = String(l.pi_email).toLowerCase()
    const local = email.split('@')[0]
    const pi = nameParts(l.pi_name as string)
    // keep if it clearly belongs to THIS PI
    if (strongMatch(local, pi)) continue
    if (GENERIC.test(email)) {
      bad.push({ url: l.lab_url as string, pi: l.pi_name as string, email, why: 'generic/support mailbox' })
      continue
    }
    if ((byEmail.get(email) ?? 0) > 1) {
      bad.push({ url: l.lab_url as string, pi: l.pi_name as string, email, why: `duplicate — same address on ${byEmail.get(email)} labs` })
      continue
    }
    // belongs to a DIFFERENT PI in our DB?
    const other = parts.find((o) => o.lab.lab_url !== l.lab_url && strongMatch(local, o.pi))
    if (other) {
      bad.push({ url: l.lab_url as string, pi: l.pi_name as string, email, why: `belongs to a different PI (${other.lab.pi_name})` })
      continue
    }
    // otherwise: no name signal but unique + not generic + not another PI → likely a cryptic alias, KEEP
  }

  console.log(`labs with a stored email: ${withEmail.length}`)
  console.log(`WILL NULL (${bad.length}):`)
  for (const b of bad) console.log(`  ${b.pi}  ✗ ${b.email}   (${b.why})`)

  if (execute) {
    for (const b of bad) await sql.query(`UPDATE lab_profiles SET pi_email = NULL WHERE lab_url = $1`, [b.url])
    console.log(`\n✓ nulled ${bad.length} wrong emails.`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
