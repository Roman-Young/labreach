export {} // module scope
// SAME-NAME VERIFICATION — Layer 1 + Layer 2 (task #8 of the 2026-08-11 attribution cleanup). READ-ONLY.
//
// The gate + the first quarantine pass trust three "confirmed" tiers: orcid_match (solid),
// name_match (full first name — looser), affiliation_match (UCSD dept, not the individual). At a lab
// whose PI shares a surname with another real researcher, the two loose tiers — and even orcid_match,
// when the PI's ORCID was RESOLVED from a contaminated set and adopted the impostor's iD — can keep the
// wrong person's paper. Proven in-session: Jessica Sullivan kept David J. Sullivan's (Johns Hopkins)
// NEJM trial; Justin Trotter kept Joe Trotter's (BD Biosciences) flow-cytometry consensus paper.
//
// This re-examines every KEPT (non-quarantined) paper whose surname-matching author's FIRST NAME does
// not match the PI, and decides with independent evidence:
//   Layer 2 (public ORCID registry, authoritative): the suspect author carries an ORCID → look up its
//     real owner (given name + employer). A different-named or non-UCSD owner → DEFINITIVE contaminant
//     (this also disproves a poisoned internal PI-ORCID). Safe to quarantine.
//   Layer 1 (from already-fetched EPMC author data, free): the suspect author has NO ORCID, a clearly
//     different full first name, and an affiliation that is NOT UCSD-specific → PROBABLE contaminant.
//     Cannot be certain (protects nickname/typo cases like Bob↔Robert at UCSD) → SURFACED for review,
//     never auto-quarantined.
//
//   npx tsx scripts/verify-samename.ts                 → all done labs (kept papers)
//   npx tsx scripts/verify-samename.ts --lab Sullivan  → only labs whose pi_name matches (testing)
//   npx tsx scripts/verify-samename.ts --limit 40      → first N labs
process.loadEnvFile('.env.local')

import { writeFileSync } from 'node:fs'
import { nameParts, editDistance, type PiName } from '../lib/name-match'
import { fetchPaperAuthors, type PaperAuthor } from '../lib/attribution'
import { orcidOwner, UCSD_EMPLOYER, ownerFirstMatches } from '../lib/orcid-registry'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const UCSD_AFFIL = /(university of california[,. ]+san diego|uc san diego|ucsd|la jolla)/i

// Does an author's first name plausibly BELONG to the PI (equal, or a prefix either way, ≥2 chars)?
// Mirrors lib/attribution.ts judgeAuthor so "sam"/"samantha", "rob"/"robert" still read as the PI.
function firstNameMatchesPi(authorFirst: string, pi: PiName): boolean {
  const a = (authorFirst.split(' ')[0] ?? '').trim()
  if (a.length < 2 || pi.first.length < 2) return false
  if (a === pi.first || a.startsWith(pi.first) || pi.first.startsWith(a)) return true
  // Typo tolerance: a one-char difference on the shared surname is a data-entry typo (our "Assutina"
  // for "Assuntina" Sacco), not a different person — so the PI's own paper is not read as a stranger's.
  return Math.min(a.length, pi.first.length) >= 4 && editDistance(a, pi.first) <= 1
}

function surnameMatch(authorLast: string, pi: PiName): boolean {
  const toks = authorLast.split(' ').filter(Boolean)
  return pi.lastsAll.some((l) => toks.includes(l))
}

type Bucket = 'definitive' | 'probable'
interface Suspect {
  labUrl: string
  piName: string
  sourceId: string
  title: string
  bucket: Bucket
  reason: string
  suspectAuthor: string // "first last (orcid) @ affiliation"
  ownerEvidence?: string // Layer-2: who the ORCID really belongs to
}

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const labArg = process.argv.indexOf('--lab')
  const labFilter = labArg >= 0 ? process.argv[labArg + 1] : null
  const urlArg = process.argv.indexOf('--urls')
  const urlList = urlArg >= 0 ? (process.argv[urlArg + 1] ?? '').split(',').filter(Boolean) : null
  const limArg = process.argv.indexOf('--limit')
  const limit = limArg >= 0 ? parseInt(process.argv[limArg + 1], 10) : 0

  let labs = rows(await sql.query(
    urlList
      ? `SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' AND lab_url = ANY($1) ORDER BY pi_name`
      : labFilter
        ? `SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' AND pi_name ILIKE $1 ORDER BY pi_name`
        : `SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' ORDER BY pi_name`,
    urlList ? [urlList] : labFilter ? [`%${labFilter}%`] : [],
  ))
  if (limit > 0) labs = labs.slice(0, limit)
  console.log(`Same-name verification over ${labs.length} labs (kept papers only)...\n`)

  const authorCache = new Map<string, PaperAuthor[] | null>()
  const authorsOf = async (sid: string): Promise<PaperAuthor[] | null> => {
    if (!authorCache.has(sid)) authorCache.set(sid, await fetchPaperAuthors(sid))
    return authorCache.get(sid) ?? null
  }

  const suspects: Suspect[] = []
  let done = 0, papersExamined = 0, firstMismatch = 0

  for (const lab of labs) {
    const pi = nameParts(lab.pi_name as string)
    if (!pi.lastsAll.length) continue
    const chunks = rows(await sql.query(
      `SELECT DISTINCT source_id, title FROM lab_chunks
        WHERE lab_url=$1 AND type='paper' AND quarantined=false AND source_id IS NOT NULL ORDER BY source_id`,
      [lab.lab_url],
    ))

    for (const c of chunks) {
      const sid = c.source_id as string
      const title = String(c.title ?? '')
      const authors = await authorsOf(sid)
      papersExamined++
      if (!authors) continue // couldn't re-fetch → honest unknown, leave as-is
      const surnameAuthors = authors.filter((a) => surnameMatch(a.last, pi))
      if (!surnameAuthors.length) continue // no surname on paper is a separate (already-quarantined) class
      // If ANY surname-author COULD be the PI — a full-first-name match, OR an initials-only author
      // whose initial is compatible — leave the paper alone. This guards the case where the PI is on
      // a paper as initials ("J Sullivan") next to a same-surname stranger ("David Sullivan"): the
      // paper is genuinely hers, so it must not be condemned on the stranger's account.
      const couldBePi = (a: PaperAuthor): boolean => {
        if (firstNameMatchesPi(a.first, pi)) return true
        const f = (a.first.split(' ')[0] ?? '').trim()
        return f.length === 1 && !!pi.first && f === pi.first[0] // compatible initial
      }
      if (surnameAuthors.some(couldBePi)) continue

      // No PI-first-name author. Look at the surname-author(s) with the most identifying signal.
      firstMismatch++
      // Prefer an author carrying an ORCID (Layer 2 can be definitive); else the first one.
      const withOrcid = surnameAuthors.find((a) => a.orcid)
      const a = withOrcid ?? surnameAuthors[0]
      const label = `${a.first} ${a.last}${a.orcid ? ` (${a.orcid})` : ''} @ ${a.affiliation.slice(0, 60) || '∅'}`

      // Layer 2 — authoritative ORCID owner lookup.
      if (a.orcid) {
        const owner = await orcidOwner(a.orcid)
        if (owner) {
          // If the ORCID's real owner IS our PI (name matches, typo-tolerant), the paper is theirs —
          // keep it regardless of what the registry lists (or omits) for employer.
          if (ownerFirstMatches(owner.given, pi.first)) continue
          const evidence = `${owner.given} ${owner.family} @ ${owner.employers[0] ?? 'no employer listed'}`
          if (owner.employers.length > 0) {
            // A KNOWN employer + a name that isn't the PI = provably a real, different person. Definitive.
            const ownerIsUcsd = owner.employers.some((e) => UCSD_EMPLOYER.test(e))
            suspects.push({
              labUrl: lab.lab_url as string, piName: lab.pi_name as string, sourceId: sid, title,
              bucket: 'definitive', reason: ownerIsUcsd ? 'orcid_owner_name_differs' : 'orcid_owner_not_ucsd',
              suspectAuthor: label, ownerEvidence: evidence,
            })
          } else {
            // Name differs but the record lists NO employer to corroborate — an empty employer is an
            // honest unknown, NOT proof of "elsewhere" (this is the trap that flagged Assuntina Sacco).
            // Cannot auto-quarantine → review.
            suspects.push({
              labUrl: lab.lab_url as string, piName: lab.pi_name as string, sourceId: sid, title,
              bucket: 'probable', reason: 'orcid_owner_name_differs_no_employer',
              suspectAuthor: label, ownerEvidence: evidence,
            })
          }
          continue
        }
        // ORCID present but unresolvable → fall through to Layer 1 judgment on name/affiliation.
      }

      // Layer 1 — no usable ORCID. Condemn only a clearly-different FULL first name whose affiliation
      // is NOT UCSD-specific (a real UCSD PI's own papers carry a UCSD/La Jolla affiliation). Anything
      // weaker (initials-only, or a UCSD affiliation) stays untouched — this is review-only.
      const aFirst = (a.first.split(' ')[0] ?? '').trim()
      const isInitialOnly = aFirst.length <= 1
      const ucsdAffil = surnameAuthors.some((x) => UCSD_AFFIL.test(x.affiliation))
      if (!isInitialOnly && aFirst.length >= 3 && !ucsdAffil) {
        suspects.push({
          labUrl: lab.lab_url as string, piName: lab.pi_name as string, sourceId: sid, title,
          bucket: 'probable', reason: 'diff_first_name_non_ucsd_affil', suspectAuthor: label,
        })
      }
    }
    done++
    if (done % 40 === 0) console.log(`  …${done}/${labs.length} labs  (${authorCache.size} papers fetched, ${suspects.length} suspects)`)
  }

  const definitive = suspects.filter((s) => s.bucket === 'definitive')
  const probable = suspects.filter((s) => s.bucket === 'probable')

  console.log(`\n═══ SUMMARY ═══`)
  console.log(`  labs examined:            ${done}`)
  console.log(`  kept papers examined:     ${papersExamined}`)
  console.log(`  PI-first-name mismatches: ${firstMismatch}`)
  console.log(`  DEFINITIVE (Layer 2, safe to quarantine): ${definitive.length}`)
  console.log(`  PROBABLE (Layer 1, needs your review):    ${probable.length}`)

  const show = (title: string, arr: Suspect[]) => {
    console.log(`\n═══ ${title} ═══`)
    const byLab = new Map<string, Suspect[]>()
    for (const s of arr) { const k = `${s.piName}`; byLab.set(k, [...(byLab.get(k) ?? []), s]) }
    for (const [piName, ss] of byLab) {
      console.log(`\n  ${piName}  (${ss.length})`)
      for (const s of ss) {
        console.log(`     ✗ [${s.reason}] "${s.title.slice(0, 60)}"  ${s.sourceId}`)
        console.log(`        author on paper: ${s.suspectAuthor}`)
        if (s.ownerEvidence) console.log(`        ORCID really belongs to: ${s.ownerEvidence}`)
      }
    }
  }
  show('DEFINITIVE contaminants (Layer 2)', definitive)
  show('PROBABLE contaminants (Layer 1 — review before quarantine)', probable)

  const out = '/tmp/samename-report.json'
  writeFileSync(out, JSON.stringify({ generatedAt: null, definitive, probable }, null, 1))
  console.log(`\nreport written: ${out}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
