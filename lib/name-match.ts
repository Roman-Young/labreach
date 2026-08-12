// Canonical PI name-matching helpers — the SINGLE source of truth.
//
// History (2026-08-11): these helpers were copy-pasted across four scripts (contact-hunt,
// recover-emails, null-bad-emails, audit-emails) and silently DIVERGED — different nameParts
// shapes ({last} vs {lasts[]}), different COMMON/GENERIC sets — so the same address could be
// judged differently by different scripts, and three successive attribution-verifier bugs each
// traced to a divergent copy. Every consumer now imports from here; do not re-inline these.
//
// Decision log encoded here:
// - nameParts returns ALL surname segments (`lasts[]`): "Schmid-Schoenbein" → ["schmid",
//   "schoenbein"] so gschmid@ matches; "Lovett-Barron" likewise. Subsumes the single-last form.
// - Credentials are stripped only as SEPARATE TOKENS (never substrings — "Wildonger" must not
//   lose its "do"), and a leading "Dr." title is dropped (it broke "Dr. Steven P. Briggs").
// - GENERIC judges the LOCAL-PART only, never the domain (ferhatay@lji.org is personal;
//   contact@lji.org is not), with token anchoring so topic inboxes like musclelab@/phages@ are
//   KEPT (Roman's rule: a lab's own stated contact inbox is fine; shared triage lines are not).
// - Exact-surname local-parts (ecker@salk.edu) count as strong on an UNCOMMON surname.
// - COMMON surnames (zhang, kim, patel, …) require the FULL first name — an initial isn't enough
//   to disambiguate (d7zhang@ for Dong-Er Zhang stays a review case, never an auto-write).

export interface PiName {
  first: string
  lasts: string[] // surname segments ≥3 chars — the EMAIL-matching set (substring-safe)
  lastsAll: string[] // every surname segment ≥2 chars — for EXACT token comparison (author
  // surnames: "Ay"/"Lu"/"Oh" are real surnames that the ≥3 filter would wrongly drop)
}

export const strip = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Token-boundary credential stripper (leading comma/space, trailing comma/space/end) + leading
// "Dr." title. Mirrors lib/email-skeleton.ts's CREDENTIALS fix — never matches inside a name.
const CREDENTIALS =
  /[,\s]+(?:ph\.?d\.?|m\.?d\.?|d\.?o\.?|m\.?s\.?c?\.?|m\.?a\.?|m\.?p\.?h\.?|d\.?d\.?s\.?|d\.?v\.?m\.?|sc\.?d\.?|m\.?b\.?a\.?|m\.?b\.?i\.?|b\.?s\.?|b\.?a\.?|fasco|facs|faap|famia)\.?(?=$|[,\s])/gi

// "Ananda Goldrath" / "Leslie Crews, Ph.D." / "Ghosh, Partho" / "Dr. Steven P. Briggs" /
// "Geert Schmid-Schoenbein" → { first, lasts[] }.
export function nameParts(pi: string | null): PiName {
  if (!pi) return { first: '', lasts: [], lastsAll: [] }
  const s = strip(pi.replace(/^dr\.?\s+/i, '').replace(CREDENTIALS, ''))
  let first = ''
  let rest: string[] = []
  if (s.includes(',')) {
    // "Last, First [Middle]" — the comma inverts the order.
    const [l, f] = s.split(',')
    first = (f || '').trim().split(' ')[0] || ''
    rest = (l || '').trim().split(' ').filter(Boolean)
  } else {
    const toks = s.split(' ').filter(Boolean)
    first = toks[0] || ''
    rest = toks.slice(1)
  }
  return { first, lasts: rest.filter((t) => t.length >= 3), lastsAll: rest.filter((t) => t.length >= 2) }
}

// Levenshtein edit distance — used to treat a DATA-ENTRY TYPO in a stored name as the same person,
// not a different one. Our own pi_name field had "Assutina" for the real "Assuntina" Sacco; a strict
// equal/prefix match then read her OWN papers as a same-surname stranger's. A distance-≤1 given-name
// difference on a shared surname is overwhelmingly a typo/transliteration, never two distinct people
// we could tell apart anyway — so callers treat it as a match. Erring toward "same person" is the
// recall-safe direction (keep the paper), consistent with the ambiguous-stays-visible decision.
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let cur = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

// Common English nickname / formal-name pairs (bidirectional). Used so a paper author who is the PI
// under a familiar form — "Randy" for "Randolph" Hampton, "Jim" for "James" Wilhelm — is recognized as
// the SAME person and the PI's own work is never quarantined as a same-surname stranger's. This is the
// load-bearing guard for the same-name cleanup: without it, ~8 PIs' own papers would be wrongly hidden.
export const NICKNAMES: ReadonlyArray<readonly [string, string]> = [
  ['randy', 'randolph'], ['jim', 'james'], ['joe', 'joseph'], ['terry', 'teresa'], ['terry', 'terrence'],
  ['bob', 'robert'], ['rob', 'robert'], ['bill', 'william'], ['will', 'william'], ['mike', 'michael'],
  ['dave', 'david'], ['dan', 'daniel'], ['chris', 'christopher'], ['tony', 'anthony'], ['rick', 'richard'],
  ['dick', 'richard'], ['ben', 'benjamin'], ['sam', 'samuel'], ['alex', 'alexander'], ['nate', 'nathan'],
  ['kate', 'katherine'], ['katie', 'katherine'], ['liz', 'elizabeth'], ['tom', 'thomas'], ['tim', 'timothy'],
  ['greg', 'gregory'], ['jeff', 'jeffrey'], ['ron', 'ronald'], ['steve', 'steven'], ['ken', 'kenneth'],
  ['pete', 'peter'], ['matt', 'matthew'], ['nick', 'nicholas'], ['andy', 'andrew'], ['ed', 'edward'],
  ['gene', 'eugene'], ['nate', 'nathaniel'], ['gabe', 'gabriel'], ['josh', 'joshua'], ['dan', 'danielle'],
]
export function isNickname(a: string, b: string): boolean {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase()
  return !!x && !!y && NICKNAMES.some(([n, f]) => (x === n && y === f) || (x === f && y === n))
}

// The canonical "are these two first names the SAME person" test: exact / prefix (sam↔samantha) /
// one-char typo (assutina↔assuntina) / known nickname (randy↔randolph). Erring toward "same" is the
// recall-safe direction — it keeps a paper rather than hiding it over a name variant.
export function firstNamesEquivalent(a: string, b: string): boolean {
  const x = (a.split(' ')[0] ?? '').trim().toLowerCase(), y = (b.split(' ')[0] ?? '').trim().toLowerCase()
  if (x.length < 2 || y.length < 2) return false
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true
  if (Math.min(x.length, y.length) >= 4 && editDistance(x, y) <= 1) return true
  return isNickname(x, y)
}

// Surnames common enough that first-initial+last is NOT identifying — require the full first name.
// (Union of the previously-diverged copies — kept net-neutral for email matching. The attribution
// classifier in lib/attribution.ts never trusts initials at all, so it doesn't lean on this set.)
export const COMMON = new Set([
  'zhang', 'li', 'wang', 'chen', 'liu', 'yang', 'huang', 'wu', 'xu', 'sun', 'ma', 'zhao', 'zhou',
  'kim', 'lee', 'park', 'cho', 'choi', 'singh', 'kumar', 'patel', 'shah', 'smith', 'johnson',
  'brown', 'jones', 'garcia', 'martinez', 'nguyen', 'tran', 'gonzalez', 'rodriguez', 'khan', 'ali',
  'das',
])

// Generic/shared mailboxes, judged by LOCAL-PART tokens only (never the domain). `(^|[.-])`
// anchoring means bare `lab@`/`office@` match but `musclelab@` does not — by design.
export const GENERIC =
  /(^|[.-])(info|admin|contact|webmaster|help|support|office|lab|no-?reply|donotreply|hr|jobs|careers|registered|available|found|application|service|online|communications)@/i

export const EMAIL_RE = /[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9.-]+\.(?:edu|org|com|net|gov)/gi
// obfuscated: "jdoe [at] ucsd [dot] edu", "jdoe (at) ucsd.edu", "jdoe at ucsd dot edu"
export const OBF_RE =
  /([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\sat\s|&#0*64;)\s*([a-z0-9.-]+?)\s*(?:\[dot\]|\(dot\)|\sdot\s|\.)\s*(edu|org|com|net|gov)/gi

// Does this local-part clearly belong to this person? (No GENERIC check — see strongMatch.)
export function localMatchesPi(localRaw: string, pi: PiName): boolean {
  const local = localRaw.toLowerCase()
  const last = pi.lasts.find((l) => local.includes(l))
  if (!last) return false
  // local-part IS exactly a surname (ecker@salk.edu) — identifying on an uncommon surname
  if (local === last && !COMMON.has(last)) return true
  const fullFirst = pi.first.length >= 3 && local.includes(pi.first)
  const initLast = !!pi.first && local.startsWith(pi.first[0])
  return COMMON.has(last) ? fullFirst : fullFirst || initLast
}

// Email-level strong match: not a generic mailbox AND the local-part identifies the person.
// This is the auto-write gate — anything weaker is review-only.
export function strongMatch(email: string, pi: PiName): boolean {
  if (GENERIC.test(email)) return false
  return localMatchesPi(email.split('@')[0] ?? '', pi)
}

// ANY name signal at all (surname, full first, or initial+surname run) — the loose test the
// audit uses for "flag for eyeballing when absent". Weaker than localMatchesPi by design.
export function weakNameSignal(localRaw: string, pi: PiName): boolean {
  const local = localRaw.toLowerCase()
  if (pi.lasts.some((l) => local.includes(l))) return true
  if (pi.first.length >= 3 && local.includes(pi.first)) return true
  return pi.lasts.some((l) => !!pi.first && local.includes(`${pi.first[0]}${l}`))
}
