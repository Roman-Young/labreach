export {} // module scope
// Quarantine the reviewed LAYER-1 same-name contaminants (task #8, the "probable" bucket that Roman
// approved: a paper whose surname-author has a DIFFERENT full first name AND a NAMED non-UCSD
// institution — proof of a distinct real person, even without an ORCID). Reads the `probable` list
// from /tmp/samename-report.json but RE-DERIVES the tier LIVE — re-fetches each paper's authors and
// re-applies the classification — so it never trusts the stale report and can never hide a paper the
// current logic wouldn't (same contract as quarantine-attribution.ts / quarantine-samename.ts).
//
// SAFETY: a surname-author who could be the PI — same first name, a one-char typo, a known NICKNAME
// (Randy↔Randolph), or a compatible initial — vetoes the whole paper. That is what keeps a PI's OWN
// work (published under a familiar name form) from being quarantined. Reversible. Dry-run by default.
//
//   npx tsx scripts/quarantine-samename-layer1.ts             → dry run (re-verifies, prints, no writes)
//   npx tsx scripts/quarantine-samename-layer1.ts --execute   → apply
process.loadEnvFile('.env.local')

import { readFileSync } from 'node:fs'
import { nameParts, firstNamesEquivalent } from '../lib/name-match'
import { fetchPaperAuthors, type PaperAuthor } from '../lib/attribution'

interface Suspect { labUrl: string; piName: string; sourceId: string; title: string; reason: string; suspectAuthor: string }

const UCSD_AFFIL = /(university of california[,. ]+san diego|uc san diego|ucsd|la jolla)/i
// A recognizable named organization in an affiliation string — a specific institution/company is what
// makes "different first name" into "provably a different person" (vs. an empty/one-word affiliation).
const NAMED_INST = /(universit|institute|college|school of|hospital|laborator|pfizer|janssen|takeda|novartis|lilly|sorrento|scripps|salk|genentech|merck|amgen|resmed|schr[oö]dinger|therapeutic|pharmaceutic|foundation|conservancy|marine|genomics|beckman|city of hope|johns hopkins|stanford|harvard|research (institute|center|laborator)|\bsciences\b|\bservices\b|technolog|clinic|center for|\bllc\b|\binc\b|\bcorp\b|department of)/i

const surnameMatch = (authorLast: string, lastsAll: string[]): boolean =>
  authorLast.split(' ').filter(Boolean).some((t) => lastsAll.includes(t))

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const execute = process.argv.includes('--execute')
  console.log(execute ? '=== EXECUTING (quarantining) ===\n' : '=== DRY RUN (pass --execute to apply) ===\n')

  const report = JSON.parse(readFileSync('/tmp/samename-report.json', 'utf8')) as { probable: Suspect[] }
  const candidates = report.probable ?? []
  console.log(`probable candidates in report: ${candidates.length}\n`)

  let confirmed = 0, vetoedByPi = 0, noNamedInst = 0, unfetchable = 0, chunksAffected = 0
  const hits: string[] = []

  for (const s of candidates) {
    const pi = nameParts(s.piName)
    const authors = await fetchPaperAuthors(s.sourceId)
    if (!authors) { unfetchable++; continue }
    const surnameAuthors = authors.filter((a) => surnameMatch(a.last, pi.lastsAll))
    if (!surnameAuthors.length) { noNamedInst++; continue }

    // VETO: any surname-author who could be the PI (name/typo/nickname, or a compatible initial).
    const couldBePi = surnameAuthors.some((a) => {
      const f = (a.first.split(' ')[0] ?? '').trim()
      if (firstNamesEquivalent(f, pi.first)) return true
      return f.length === 1 && !!pi.first && f === pi.first[0]
    })
    if (couldBePi) { vetoedByPi++; continue }

    // Require a surname-author with a different FULL first name at a NAMED non-UCSD institution.
    const offender = surnameAuthors.find((a) => {
      const f = (a.first.split(' ')[0] ?? '').trim()
      return f.length >= 3 && !firstNamesEquivalent(f, pi.first) &&
        a.affiliation.trim() && !UCSD_AFFIL.test(a.affiliation) && NAMED_INST.test(a.affiliation)
    })
    if (!offender) { noNamedInst++; continue }

    confirmed++
    hits.push(`${s.piName}  ←  ${offender.first} ${offender.last} @ ${offender.affiliation.slice(0, 46)}`)
    if (execute) {
      const res = await sql.query(
        `UPDATE lab_chunks SET quarantined = true, quarantine_reason = $3
           WHERE lab_url = $1 AND source_id = $2 AND type = 'paper' AND quarantined = false
           RETURNING source_id`,
        [s.labUrl, s.sourceId, 'samename:layer1_named_nonucsd'],
      )
      chunksAffected += Array.isArray(res) ? res.length : ((res as { rows?: unknown[] }).rows?.length ?? 0)
    }
  }

  console.log(`re-verified contaminants:                 ${confirmed}`)
  console.log(`  vetoed (a surname-author COULD be PI):  ${vetoedByPi}`)
  console.log(`  skipped (no named non-UCSD institution):${noNamedInst}`)
  console.log(`  unfetchable:                            ${unfetchable}`)
  if (execute) console.log(`\n✓ quarantined ${chunksAffected} chunks`)
  else {
    console.log(`\nwould quarantine ${confirmed} papers:`)
    for (const h of hits) console.log(`  ${h}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
