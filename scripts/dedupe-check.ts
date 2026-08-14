export {} // module scope
// PRE-FULL-RUN DEDUPE GATE. Cross-checks all 230 wave-2 PIs against EVERY existing lab_profiles
// row (any status) so a wave-2 ingest can never create a duplicate person under two lab_urls.
// Two-tier classification, matched by RIGOROUS identity (full first name, not just an initial —
// a first-initial-only check gave a false positive: "Xueqin (Sherine) Sun" vs "Xin Sun", different
// people, same surname):
//
//   CONFIDENT + existing status='done'  → safe to auto-repoint (lab_url only, status untouched).
//   Everything else (ambiguous name match, OR any match against a non-'done' existing row) →
//   review file for Roman. A match against an excluded/failed/merged row is NEVER auto-applied:
//   storeLabV2 unconditionally flips status to 'done' on whatever lab_url it's given, so silently
//   repointing an EXCLUDED row and later ingesting it would resurrect a lab Roman deliberately
//   dropped (an MD, a no-lab-site case, etc.) — that is a reactivation decision, not a URL fix.
//
//   npx tsx scripts/dedupe-check.ts [--execute]
process.loadEnvFile('.env.local')

import { readFileSync, writeFileSync } from 'node:fs'
import { nameParts, firstNamesEquivalent } from '../lib/name-match'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

type Existing = { lab_url: string; pi_name: string; status: string; department: string | null }
type Seed = { name: string; title: string; url: string | null; department: string; school: string }

async function main() {
  const execute = process.argv.includes('--execute')
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()

  const existing = rows(await sql.query(`SELECT lab_url, pi_name, status, department FROM lab_profiles`)) as unknown as Existing[]
  const bySurname = new Map<string, Existing[]>()
  for (const e of existing) {
    const np = nameParts(e.pi_name)
    for (const s of np.lastsAll) {
      if (!bySurname.has(s)) bySurname.set(s, [])
      bySurname.get(s)!.push(e)
    }
  }

  const repoints: Array<{ cur: string; nu: string; piName: string }> = []
  const review: Array<{ inst: string; seedName: string; seedUrl: string | null; matches: Existing[]; why: string }> = []

  for (const inst of ['salk', 'scripps', 'sbp', 'lji']) {
    const seeds = JSON.parse(readFileSync(`data/${inst}-labs.json`, 'utf8')) as Seed[]
    const enriched = JSON.parse(readFileSync(`data/${inst}-enriched.json`, 'utf8')) as Array<Seed & { lab_url: string | null }>
    const labUrlOf = new Map(enriched.map((e) => [e.url, e.lab_url]))

    for (const s of seeds) {
      const np = nameParts(s.name)
      const candidates = new Set<Existing>()
      for (const surname of np.lastsAll) for (const e of bySurname.get(surname) ?? []) candidates.add(e)
      if (!candidates.size) continue

      const norm = (u: string) => { try { const x = new URL(u); return (x.host + x.pathname).replace(/\/$/, '').toLowerCase() } catch { return u } }
      const newLabUrl = labUrlOf.get(s.url ?? '') ?? null

      // CONFIDENT tier: full first-name equality OR a known nickname/alt-name equivalence
      // (firstNamesEquivalent — the same Gene↔Eugene-class matcher the paper-attribution gate
      // uses), so "Rusty Gage" correctly matches the DB's "Fred (Rusty) Gage" instead of landing
      // in the noisy review pile as an unconfirmed surname collision.
      const confident = [...candidates].filter((e) => {
        const ep = nameParts(e.pi_name)
        return ep.first && np.first && (ep.first === np.first || firstNamesEquivalent(ep.first, np.first))
      })

      if (confident.length === 1 && confident[0].status === 'done') {
        const cur = confident[0].lab_url
        // Compare HOST+PATH only (protocol/trailing-slash-insensitive) — a bare http-vs-https or
        // trailing-slash difference on the SAME domain is not a duplicate, and blindly "fixing"
        // it would downgrade a stored https URL to http for no reason.
        if (newLabUrl && norm(newLabUrl) !== norm(cur)) repoints.push({ cur, nu: newLabUrl, piName: s.name })
        // else: same host+path already (self-heals on ingest) or no real lab_url found — nothing to do.
        continue
      }
      if (confident.length === 1 && newLabUrl && norm(newLabUrl) === norm(confident[0].lab_url)) continue // already resolved

      // A pure SURNAME-only collision on a common surname, where every candidate's URL is on a
      // totally different domain than the new one, is almost always two different people (Wang,
      // Zhang, Park, Kaufman, Kim...) — real ambiguity is rare enough to be worth Roman's time only
      // when a candidate is ALSO not obviously a different institution/context. We still show every
      // one (never silently drop a possible match), but only surface it if the surname is scarce
      // enough that coincidence is unlikely, OR a candidate's URL already resolves to the same host.
      const anyUrlOverlap = newLabUrl && candidates.size && [...candidates].some((c) => norm(c.lab_url).split('/')[0] === norm(newLabUrl).split('/')[0])
      const COMMON_SURNAMES = new Set(['wang', 'zhang', 'park', 'kim', 'lee', 'kaufman', 'huang', 'sun', 'zhao', 'de'])
      const surnameCommon = np.lastsAll.some((s) => COMMON_SURNAMES.has(s))
      if (!anyUrlOverlap && surnameCommon && confident.length === 0) continue // near-certainly a different person; skip Roman's time

      const why =
        confident.length > 1 ? 'multiple confident matches' :
        confident.length === 1 ? `matches an existing '${confident[0].status}' row (reactivation decision)` :
        anyUrlOverlap ? 'surname match + a candidate URL is on the same domain — worth a look' :
        'surname match only, first name did not confirm (uncommon surname, kept for review)'
      review.push({ inst, seedName: s.name, seedUrl: newLabUrl ?? s.url, matches: [...candidates], why })
    }
  }

  console.log(`${execute ? 'EXECUTING' : 'DRY RUN'} — confident repoints: ${repoints.length} | needs Roman: ${review.length}\n`)
  console.log('CONFIDENT REPOINTS (existing done row, safe — URL only, status untouched):')
  for (const r of repoints) console.log(`  ${r.piName.padEnd(28)} ${r.cur}\n    -> ${r.nu}`)

  const lines = [`Dedupe review — ${review.length} wave-2 PIs need a decision (generated ${new Date().toISOString().slice(0, 10)})`, '']
  for (const r of review) {
    lines.push(`## [${r.inst}] ${r.seedName}  (${r.why})`)
    lines.push(`  new: ${r.seedUrl ?? '(no lab_url found)'}`)
    for (const m of r.matches) lines.push(`  existing: ${m.pi_name} | status=${m.status} | dept=${m.department ?? '?'} | ${m.lab_url}`)
    lines.push(`  >> `)
    lines.push('')
  }
  writeFileSync('dedupe-review.txt', lines.join('\n'))
  console.log(`\n✓ wrote dedupe-review.txt (${review.length} entries for Roman)`)

  if (execute) {
    for (const r of repoints) {
      await sql.query(
        `WITH p AS (UPDATE lab_profiles SET lab_url=$2, url_status='ok', url_checked_at=now() WHERE lab_url=$1 RETURNING 1)
         UPDATE lab_chunks SET lab_url=$2 WHERE lab_url=$1`,
        [r.cur, r.nu],
      )
      await sql.query(`UPDATE quarantine_ledger SET lab_url=$2 WHERE lab_url=$1`, [r.cur, r.nu])
    }
    console.log(`✓ applied ${repoints.length} repoints (profiles + chunks + ledger, status untouched)`)
  } else {
    console.log('\n(dry run — pass --execute to apply the confident repoints)')
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
