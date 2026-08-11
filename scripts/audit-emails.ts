export {} // module scope
// READ-ONLY audit of the emails ALREADY in the DB. Flags any stored pi_email whose local-part
// carries NO signal of the PI's name (no last name, no first name, no first-initial+last) or that is
// a generic mailbox — i.e. the ones most likely to be a co-author or a support address that slipped
// in at ingest. Writes nothing.  npx tsx scripts/audit-emails.ts
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
const GENERIC = /^(info|admin|contact|webmaster|help|support|office|lab|no-?reply|donotreply|hr|jobs|careers|registered|available|found|application|service|online)@/i

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
    const hasLast = pi.last.length >= 3 && local.includes(pi.last)
    const hasFirst = pi.first.length >= 3 && local.includes(pi.first)
    const hasInitLast = !!pi.first && pi.last.length >= 3 && local.includes(`${pi.first[0]}${pi.last}`)
    if (!hasLast && !hasFirst && !hasInitLast) {
      flagged.push({ pi: l.pi_name as string, email, why: `no name signal (PI: ${pi.first} ${pi.last})` })
    }
  }

  console.log(`\nAudited ${labs.length} labs with a stored email.`)
  console.log(`Name-consistent (pass): ${labs.length - flagged.length}`)
  console.log(`\nFLAGGED for eyeball — email carries no sign of the PI's name (${flagged.length}):`)
  for (const f of flagged) console.log(`  ${f.pi}  →  ${f.email}   (${f.why})`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })
