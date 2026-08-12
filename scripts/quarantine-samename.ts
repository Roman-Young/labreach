export {} // module scope
// Quarantine the DEFINITIVE same-name contaminants found by scripts/verify-samename.ts (task #8).
// Reads /tmp/samename-report.json but RE-VERIFIES every candidate against the LIVE registry + author
// data before writing — a stale report can never quarantine something the current logic wouldn't
// (same safety contract as scripts/quarantine-attribution.ts). Only the `definitive` bucket (a suspect
// author whose ORCID resolves, in the public registry, to a different-named or non-UCSD person) is
// eligible; the `probable` bucket is review-only and is never touched here. Reversible:
// `UPDATE lab_chunks SET quarantined=false`. Dry-run by default.
//
//   npx tsx scripts/quarantine-samename.ts             → dry run (re-verifies, prints, no writes)
//   npx tsx scripts/quarantine-samename.ts --execute   → apply
process.loadEnvFile('.env.local')

import { readFileSync } from 'node:fs'
import { nameParts, editDistance } from '../lib/name-match'
import { fetchPaperAuthors } from '../lib/attribution'
import { orcidOwner, ownerFirstMatches } from '../lib/orcid-registry'

interface Suspect {
  labUrl: string; piName: string; sourceId: string; title: string
  bucket: 'definitive' | 'probable'; reason: string; suspectAuthor: string; ownerEvidence?: string
}

const surnameMatch = (authorLast: string, lastsAll: string[]): boolean => {
  const toks = authorLast.split(' ').filter(Boolean)
  return lastsAll.some((l) => toks.includes(l))
}

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const execute = process.argv.includes('--execute')
  console.log(execute ? '=== EXECUTING (quarantining) ===\n' : '=== DRY RUN (pass --execute to apply) ===\n')

  const report = JSON.parse(readFileSync('/tmp/samename-report.json', 'utf8')) as { definitive: Suspect[] }
  const candidates = report.definitive ?? []
  console.log(`definitive candidates in report: ${candidates.length}\n`)

  let confirmed = 0, recanted = 0, unfetchable = 0, chunksAffected = 0
  const hits: string[] = []

  for (const s of candidates) {
    const pi = nameParts(s.piName)
    // Re-fetch the paper's authors and re-find the surname-matching author that carries an ORCID.
    const authors = await fetchPaperAuthors(s.sourceId)
    if (!authors) { unfetchable++; continue }
    const surnameAuthors = authors.filter((a) => surnameMatch(a.last, pi.lastsAll))
    // If any surname-author could be the PI (name match incl. a one-char typo, or a compatible
    // initial), do NOT quarantine.
    const couldBePi = surnameAuthors.some((a) => {
      const f = (a.first.split(' ')[0] ?? '').trim()
      if (f.length >= 2 && pi.first.length >= 2 && (f === pi.first || f.startsWith(pi.first) || pi.first.startsWith(f))) return true
      if (f.length >= 4 && pi.first.length >= 4 && editDistance(f, pi.first) <= 1) return true
      return f.length === 1 && !!pi.first && f === pi.first[0]
    })
    if (couldBePi) { recanted++; continue }

    // Re-run Layer 2 live: a surname-author whose ORCID owner is a DIFFERENT real person with a
    // KNOWN employer. An empty employer is an honest unknown (the Sacco trap) and is NOT proof — such
    // a candidate is review-only and must never reach this executor, so require a known employer here.
    let proven: { author: string; owner: string } | null = null
    for (const a of surnameAuthors.filter((x) => x.orcid)) {
      const owner = await orcidOwner(a.orcid as string)
      if (!owner) continue
      if (ownerFirstMatches(owner.given, pi.first)) continue // owner IS our PI → keep
      if (owner.employers.length === 0) continue // no corroborating employer → not definitive
      proven = { author: `${a.first} ${a.last} (${a.orcid})`, owner: `${owner.given} ${owner.family} @ ${owner.employers[0]}` }
      break
    }
    if (!proven) { recanted++; continue } // live registry no longer supports it → skip (safety)

    confirmed++
    hits.push(`${s.piName} — "${s.title.slice(0, 50)}"  [${proven.author} → ${proven.owner}]`)
    if (execute) {
      const res = await sql.query(
        `UPDATE lab_chunks SET quarantined = true, quarantine_reason = $3
           WHERE lab_url = $1 AND source_id = $2 AND type = 'paper' AND quarantined = false`,
        [s.labUrl, s.sourceId, `samename:${s.reason}`],
      )
      chunksAffected += (res as { rowCount?: number }).rowCount ?? (Array.isArray(res) ? res.length : 0)
    }
  }

  console.log(`re-verified contaminants: ${confirmed}`)
  console.log(`  recanted (live no longer agrees, skipped): ${recanted}`)
  console.log(`  unfetchable (skipped):                     ${unfetchable}`)
  if (execute) console.log(`\n✓ quarantined ${chunksAffected} chunks`)
  else {
    console.log(`\nwould quarantine ${confirmed} papers:`)
    for (const h of hits) console.log(`  ${h}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
