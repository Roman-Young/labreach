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

// Common surnames where first-initial+last is NOT enough (many people share them) — require the
// full first name in the local part before trusting the match.
const COMMON = new Set([
  'zhang', 'li', 'wang', 'chen', 'liu', 'yang', 'huang', 'wu', 'xu', 'sun', 'ma', 'zhao', 'zhou', 'kim',
  'lee', 'park', 'cho', 'choi', 'singh', 'kumar', 'patel', 'shah', 'smith', 'johnson', 'brown', 'jones',
  'garcia', 'martinez', 'nguyen', 'tran', 'gonzalez', 'rodriguez', 'khan', 'ali', 'das',
])

const EMAIL_RE = /[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9.-]+\.(?:edu|org|com|net|gov)/gi
const OBF_RE = /([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\sat\s|&#0*64;)\s*([a-z0-9.-]+?)\s*(?:\[dot\]|\(dot\)|\sdot\s|\.)\s*(edu|org|com|net|gov)/gi
const GENERIC = /^(info|admin|contact|webmaster|help|support|office|lab|no-?reply|donotreply|hr|jobs|careers|registered|available|found|application|service|online)@/i

// Gate B. Returns {strong, reason}. Strong = safe to auto-write (paired with Gate A + not obfuscated).
function nameMatch(email: string, pi: { first: string; last: string }): { strong: boolean; reason: string } {
  const local = email.split('@')[0].toLowerCase()
  if (GENERIC.test(email)) return { strong: false, reason: 'generic mailbox' }
  if (pi.last.length < 3) return { strong: false, reason: 'no usable PI last name' }
  if (!local.includes(pi.last)) return { strong: false, reason: `local-part lacks last name "${pi.last}"` }
  const hasFullFirst = pi.first.length >= 3 && local.includes(pi.first)
  const hasFirstInit = !!pi.first && local.startsWith(pi.first[0])
  if (COMMON.has(pi.last)) {
    return hasFullFirst
      ? { strong: true, reason: `full name in local-part (${pi.first} ${pi.last}); common surname disambiguated` }
      : { strong: false, reason: `common surname "${pi.last}" without full first name — REVIEW` }
  }
  if (hasFullFirst || hasFirstInit) return { strong: true, reason: `local-part matches PI (${pi.first} ${pi.last})` }
  return { strong: false, reason: `last name present but no first-name signal — REVIEW` }
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
        [...plain, ...obfs].find((e) => pi.last.length >= 3 && e.split('@')[0].includes(pi.last)) ??
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
      await sql.query(`UPDATE lab_profiles SET pi_email = $2 WHERE lab_url = $1 AND (pi_email IS NULL OR pi_email='')`, [w.url, w.email])
    }
    console.log(`\n✓ wrote ${write.length} grounded, name-matched emails.`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
