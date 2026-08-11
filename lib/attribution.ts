// Paper→PI attribution: the ONE identity classifier shared by the measurement script
// (verify-attribution), the ingest gate (gatherPapers), and the quarantine cleanup. Built after
// the 2026-08-11 mis-attribution finding: papers were gathered by AUTH:"{Surname} {Initial}" with
// no identity check, so different people sharing a surname got merged into a lab (a nuclear-fusion
// paper under cardiac biologist Sylvia Evans — the "S Evans" search can't tell Sylvia from
// Suzanne). Three throwaway verifier heuristics each had their own bugs; this lib replaces them.
//
// Verdicts are deliberately THREE-way — "can't confirm" is not "wrong":
//   confirmed   — an author provably is the PI (ORCID match; full-first-name match; or
//                 surname + UCSD/La Jolla affiliation)
//   contaminant — provably a DIFFERENT person (no surname match at all, or every surname-matching
//                 author has a contradicting full first name / first initial / ORCID)
//   ambiguous   — a surname-matching author exists but the record carries only compatible initials
//                 and no ORCID/affiliation. Kept VISIBLE per Roman's 2026-08-11 decision (recall);
//                 only proven contaminants are quarantined/dropped.

import { withRetry } from '@/lib/retry'
import { strip, type PiName } from '@/lib/name-match'

export interface PaperAuthor {
  first: string // normalized (strip) full first name(s), possibly '' or a bare initial
  last: string // normalized surname
  orcid: string | null
  affiliation: string // free text, possibly ''
}

export interface PiIdentity extends PiName {
  orcid?: string | null
}

export type AttributionVerdict = 'confirmed' | 'contaminant' | 'ambiguous'

// Strong institutional signal for "this author is our PI" — deliberately NOT bare "san diego"
// (that free-text substring matches Scripps/SDSU/Navy/biotech and is exactly what let the original
// ingest contaminate). la jolla is kept: UCSD's campus address, overwhelmingly UCSD-affiliated in
// author strings, and rule 3 only fires on an author who ALSO matches the PI's surname.
const UCSD_AFFIL = /(university of california[,. ]+san diego|uc san diego|ucsd|la jolla)/i

// The broader San-Diego research region. Used only in the NEGATIVE direction: an initials-only
// author whose affiliation is explicitly OUTSIDE this region is someone else (the "S. Evans at
// Los Alamos" case on a 1,356-author physics paper). Kept broad so a San-Diego-region author is
// never excluded by this test — exclusion by affiliation must be unambiguous.
const SD_REGION = /(san diego|la jolla|ucsd|salk|scripps|sanford burnham|sbp discovery|lji)/i

// Per-author judgment relative to the PI: is this specific author the PI, someone else, or unknowable?
type AuthorStatus = 'is_pi' | 'not_pi' | 'unknown'

function authorStatus(a: PaperAuthor, pi: PiIdentity): AuthorStatus {
  // ORCID is definitive in both directions when both sides are known.
  if (a.orcid && pi.orcid) return a.orcid === pi.orcid ? 'is_pi' : 'not_pi'

  const aFirst = (a.first.split(' ')[0] ?? '').trim()
  const nameConfirms =
    aFirst.length >= 2 &&
    pi.first.length >= 2 &&
    (aFirst === pi.first || aFirst.startsWith(pi.first) || pi.first.startsWith(aFirst))
  if (nameConfirms) return 'is_pi'

  // A MISMATCHED initial excludes outright ("q jiang" is not "fay jiang") — a single letter has
  // no nickname/typo ambiguity, so this is safe without an affiliation rescue.
  if (aFirst.length === 1 && pi.first && aFirst !== pi.first[0]) return 'not_pi'

  // AFFILIATION RESCUE — checked for every remaining case, including a full-name MISMATCH, not
  // just initials-only. This is the fix for the 2026-08-11 false-positive wave: "Randy Hampton"
  // vs. an author's real "Randolph Y Hampton" (a nickname), and a typo in our own stored pi_name
  // ("Assutina" vs. the real "Assuntina" Sacco) both hard-excluded on name alone before this
  // rescue could run — wrongly quarantining a PI's own papers. A clear UCSD/La Jolla affiliation
  // on a surname-matching author outweighs a superficial first-name mismatch.
  if (UCSD_AFFIL.test(a.affiliation)) return 'is_pi'

  // Explicitly placed at an institution OUTSIDE the San Diego region → someone else, REGARDLESS
  // of whether the name superficially confirmed-or-not (this is what makes de Silva's dermatology
  // paper and Evans's fusion-physics paper correctly excluded even though the name check alone
  // can't run on initials).
  if (a.affiliation.trim() && !SD_REGION.test(a.affiliation)) return 'not_pi'

  // A full-name MISMATCH with no affiliation signal either way (can't confirm, can't rule out) is
  // NOT enough on its own to condemn a paper — nicknames and data-entry typos are common enough
  // (see above) that name-mismatch-alone must never be the sole basis for 'not_pi'. Honest unknown.
  return 'unknown'
}

// Surname match by EXACT TOKEN equality — "de Silva" tokens {de, silva} match PI last "silva";
// "Schmid-Schoenbein" matches either segment; but "Luo" never matches PI "Lu" (substring matching
// here is exactly the noise that caused earlier false verdicts).
function surnameMatches(authorLast: string, pi: PiIdentity): boolean {
  const toks = authorLast.split(' ').filter(Boolean)
  return pi.lastsAll.some((l) => toks.includes(l))
}

// Classify one paper's author list against the PI.
export function classifyPaper(authors: PaperAuthor[], pi: PiIdentity): AttributionVerdict {
  if (!pi.lastsAll.length) return 'ambiguous' // unusable PI name — never condemn on no evidence
  const sameSurname = authors.filter((a) => surnameMatches(a.last, pi))
  if (!sameSurname.length) return 'contaminant' // the PI is not on this paper at all
  const statuses = sameSurname.map((a) => authorStatus(a, pi))
  if (statuses.includes('is_pi')) return 'confirmed'
  if (statuses.includes('unknown')) return 'ambiguous'
  return 'contaminant' // every surname-matching author is provably someone else
}

// Resolve the PI's ORCID from their own (possibly contaminated) paper set: the modal ORCID among
// surname-matching authors, trusted ONLY if it appears on ≥2 papers whose author independently
// confirms by name/affiliation (guards against a contaminated set electing an impostor's ORCID).
export function resolvePiOrcid(papersAuthors: PaperAuthor[][], pi: PiName): string | null {
  const confirmedCount = new Map<string, number>()
  for (const authors of papersAuthors) {
    for (const a of authors) {
      if (!a.orcid) continue
      if (!surnameMatches(a.last, { ...pi, orcid: null })) continue
      // independent confirmation WITHOUT the ORCID tier
      const st = authorStatus({ ...a, orcid: null }, { ...pi, orcid: null })
      if (st === 'is_pi') confirmedCount.set(a.orcid, (confirmedCount.get(a.orcid) ?? 0) + 1)
    }
  }
  let best: string | null = null
  let bestN = 0
  for (const [orcid, n] of confirmedCount) {
    if (n > bestN) {
      best = orcid
      bestN = n
    }
  }
  return bestN >= 2 ? best : null
}

// ── Europe PMC author fetch (by DOI/PMID) ───────────────────────────────────
// Same defensive posture as scripts/contact-hunt.ts taught us (2026-08-11): a sliding-window
// throttle BEFORE every request (silent rate-limit responses once masqueraded as "no data" and
// corrupted a whole verification run), plus withRetry for transient failures.

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 240 // EPMC tolerates ~10 req/s; stay far under
const requestTimes: number[] = []
async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (requestTimes.length && now - requestTimes[0] > WINDOW_MS) requestTimes.shift()
    if (requestTimes.length < MAX_PER_WINDOW) {
      requestTimes.push(now)
      return
    }
    await new Promise((r) => setTimeout(r, requestTimes[0] + WINDOW_MS - now + 50))
  }
}

// Map one raw EPMC author record → PaperAuthor. Exported for reuse by mapEpmc in sources.ts
// (the ingest path gets authors from the SEARCH response; this fetch path gets them by id).
export function mapEpmcAuthor(a: Record<string, unknown>): PaperAuthor {
  const affilList =
    ((a.authorAffiliationDetailsList as { authorAffiliation?: Array<{ affiliation?: unknown }> } | undefined)
      ?.authorAffiliation ?? [])
      .map((x) => String(x.affiliation ?? ''))
      .filter(Boolean)
  const orcidRaw = (a.authorId as { type?: string; value?: string } | undefined)
  return {
    first: strip(String(a.firstName ?? '')),
    last: strip(String(a.lastName ?? '')),
    orcid: orcidRaw?.type === 'ORCID' && orcidRaw.value ? String(orcidRaw.value) : null,
    affiliation: [...affilList, String(a.affiliation ?? '')].filter(Boolean).join(' ; '),
  }
}

// Fetch a paper's full author list by source id ("doi:10...." | "pmid:12345" | bare value).
// null = could not fetch / not indexed (an honest unknown — never treat as contaminant).
export async function fetchPaperAuthors(sourceId: string): Promise<PaperAuthor[] | null> {
  const m = sourceId.match(/^(doi|pmid):(.+)$/)
  const [kind, id] = m ? [m[1], m[2]] : [/^\d+$/.test(sourceId) ? 'pmid' : 'doi', sourceId]
  const query = kind === 'pmid' ? `EXT_ID:${id} AND SRC:MED` : `DOI:"${id}"`
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=1`
  try {
    await throttle()
    const data = await withRetry(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`EPMC author fetch ${res.status}`)
      return (await res.json()) as {
        resultList?: { result?: Array<{ authorList?: { author?: Array<Record<string, unknown>> } }> }
      }
    })
    const list = data.resultList?.result?.[0]?.authorList?.author
    if (!list) return null
    return list.map(mapEpmcAuthor)
  } catch {
    return null
  }
}
