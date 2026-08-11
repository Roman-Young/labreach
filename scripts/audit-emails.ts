export {} // module scope
// READ-ONLY audit of the emails ALREADY in the DB. Flags any stored pi_email whose local-part
// carries NO signal of the PI's name (no last name, no first name, no first-initial+last) or that is
// a generic mailbox — i.e. the ones most likely to be a co-author or a support address that slipped
// in at ingest. Writes nothing.  npx tsx scripts/audit-emails.ts
process.loadEnvFile('.env.local')

import { nameParts, weakNameSignal, GENERIC } from '../lib/name-match'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const labs = rows(await sql.query(
    `SELECT lab_url, pi_name, pi_email FROM lab_profiles WHERE status='done' AND pi_email IS NOT NULL AND pi_email <> '' ORDER BY pi_name`,
  ))

  const flagged: Array<{ pi: string; email: string; why: string }> = []
  for (const l of labs) {
    const email = (l.pi_email as string).toLowerCase()
    const local = email.split('@')[0]
    const pi = nameParts(l.pi_name as string)
    if (GENERIC.test(email)) {
      flagged.push({ pi: l.pi_name as string, email, why: 'generic mailbox' })
      continue
    }
    if (!weakNameSignal(local, pi)) {
      flagged.push({ pi: l.pi_name as string, email, why: `no name signal (PI: ${pi.first} ${pi.lasts.join(' ')})` })
    }
  }

  console.log(`\nAudited ${labs.length} labs with a stored email.`)
  console.log(`Name-consistent (pass): ${labs.length - flagged.length}`)
  console.log(`\nFLAGGED for eyeball — email carries no sign of the PI's name (${flagged.length}):`)
  for (const f of flagged) console.log(`  ${f.pi}  →  ${f.email}   (${f.why})`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })
