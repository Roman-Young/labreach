// Public ORCID registry (pub.orcid.org) — free, no key. The AUTHORITATIVE, independent identity
// source used by the same-name verification (task #8, 2026-08-11): given an ORCID, resolve its real
// owner (name + employer institutions). This is deliberately independent of lib/attribution.ts's
// resolvePiOrcid, which infers a PI's ORCID from their own (possibly contaminated) paper set and can
// therefore adopt an impostor's iD at a shared-surname lab — the exact failure this cross-check exists
// to catch (Jessica Sullivan's papers had adopted David J. Sullivan's / Johns Hopkins ORCID).
//
// Single source of truth: both scripts/verify-samename.ts (measure) and scripts/quarantine-samename.ts
// (act) import from here, so the registry parsing can never diverge between them.

import { withRetry } from '@/lib/retry'
import { editDistance } from '@/lib/name-match'

// Sliding-window throttle (mirrors lib/attribution.ts) BEFORE every request — a silent 429
// masquerading as "no employer listed" would wrongly condemn a real PI, so stay conservative.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 180
const reqTimes: number[] = []
async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (reqTimes.length && now - reqTimes[0] > WINDOW_MS) reqTimes.shift()
    if (reqTimes.length < MAX_PER_WINDOW) { reqTimes.push(now); return }
    await new Promise((r) => setTimeout(r, reqTimes[0] + WINDOW_MS - now + 50))
  }
}

export interface OrcidOwner {
  orcid: string
  given: string // lowercased given (first) name from the registry record
  family: string // lowercased family (sur) name
  employers: string[] // employment organization names, verbatim
}

const ownerCache = new Map<string, OrcidOwner | null>()

// Resolve an ORCID iD → its authoritative owner. null = could not resolve (an honest unknown; callers
// must NEVER treat a null as evidence of anything — it is not a condemnation). Cached per-process.
export async function orcidOwner(orcid: string): Promise<OrcidOwner | null> {
  if (ownerCache.has(orcid)) return ownerCache.get(orcid) ?? null
  let out: OrcidOwner | null = null
  try {
    await throttle()
    out = await withRetry(async () => {
      const res = await fetch(`https://pub.orcid.org/v3.0/${orcid}/record`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) throw new Error(`ORCID record ${res.status}`)
      const d = (await res.json()) as Record<string, any>
      const name = d.person?.name
      const employers = ((d['activities-summary']?.employments?.['affiliation-group'] ?? []) as any[])
        .flatMap((g) => g.summaries ?? [])
        .map((s) => s['employment-summary']?.organization?.name)
        .filter((x: unknown): x is string => typeof x === 'string')
      return {
        orcid,
        given: String(name?.['given-names']?.value ?? '').toLowerCase().trim(),
        family: String(name?.['family-name']?.value ?? '').toLowerCase().trim(),
        employers,
      }
    })
  } catch {
    out = null
  }
  ownerCache.set(orcid, out)
  return out
}

// Strong UCSD institutional signal in an employer string (same set as the attribution gate).
export const UCSD_EMPLOYER = /(university of california[,. ]+san diego|uc san diego|ucsd|la jolla)/i

// Does a registry owner's given name plausibly match a PI first name (equal / prefix either way, or
// within a one-character typo — see editDistance)? Typo tolerance stops a stored-name misspelling
// from reading the PI's own ORCID as a stranger's.
export function ownerFirstMatches(ownerGiven: string, piFirst: string): boolean {
  const g = ownerGiven.trim()
  if (g.length < 2 || piFirst.length < 2) return false
  if (g === piFirst || g.startsWith(piFirst) || piFirst.startsWith(g)) return true
  return Math.min(g.length, piFirst.length) >= 4 && editDistance(g, piFirst) <= 1
}
