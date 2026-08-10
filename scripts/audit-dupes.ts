// Duplicate-lab inventory (READ-ONLY audit). The 13-directory enumeration created one
// lab_profiles row per (directory listing), so a PI listed in two departments produced
// TWO rows with different lab_urls (confirmed: Hannah Carter, Johannes Schöneberg).
// This script inventories all candidate duplicates BEFORE any merge pass:
//
//   npx tsx scripts/audit-dupes.ts
//
// Grouping signals:
//   STRONG — identical normalized PI name (lowercase, credentials stripped, diacritics
//            folded, punctuation stripped, SORTED token set so "Last, First" == "First Last"),
//            OR a shared lab-specific root domain of lab_url (generic/shared hosts skipped).
//   WEAK   — first-token initial + identical last token (e.g. "J. Smith" vs "John Smith"),
//            reported separately, only for pairs not already in a strong group.
//
// Output: per group, each member's url/pi/department/chunks/site-pages/enrichment flags,
// plus a PROPOSED KEEPER (most chunks; tiebreak most site pages). No writes are made.
export {} // module scope (isolates top-level `main` from sibling CLI scripts)
process.loadEnvFile('.env.local')

type Row = {
  lab_url: string
  lab_name: string | null
  pi_name: string | null
  department: string | null
  school: string | null
  status: string
  has_summary: boolean
  has_apply: boolean
  chunks: number
  sitePages: number
}

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

// ── PI-name normalization ──────────────────────────────────────────────────────
// Credential/title tokens to strip AFTER punctuation removal (so "Ph.D." -> "phd").
const CRED = new Set([
  'phd', 'md', 'do', 'ms', 'msc', 'mph', 'mba', 'dr', 'prof', 'professor', 'dphil',
  'pharmd', 'dvm', 'dds', 'rn', 'facs', 'frcp', 'mpp', 'ma', 'bs', 'ba', 'jr', 'sr',
  'ii', 'iii', 'iv', 'pe', 'msce', 'meng', 'scd', 'edd', 'np', 'pa', 'faan',
])

function nameTokens(name: string | null): string[] {
  if (!name) return []
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // fold diacritics: é -> e, ö -> o
    .toLowerCase()
    .replace(/\./g, '')              // remove periods FIRST so "ph.d." -> "phd", "m.d." -> "md"
    .replace(/\(.*?\)/g, ' ')        // drop parenthetical nicknames: "Kathleen (Kit) Curtius"
    .replace(/[^a-z\s]/g, ' ')       // remaining punctuation (commas, hyphens) -> space
    .split(/\s+/)
    .filter((t) => t && !CRED.has(t))
    // Fold German-style transliterations so "Schöneberg" (-> schoneberg after NFD)
    // matches "Schoeneberg". Collision risk is negligible within a full-name match.
    .map((t) => t.replace(/oe/g, 'o').replace(/ae/g, 'a').replace(/ue/g, 'u'))
}

// STRONG name key: sorted token set (handles "Last, First" vs "First Last").
// Single-letter tokens (middle initials) are dropped when >=2 real tokens remain,
// so "Amy M. Sitapati" == "Amy Sitapati" but "J. Smith" keeps its initial.
const strongNameKey = (name: string | null): string | null => {
  const t = nameTokens(name)
  if (!t.length) return null
  const full = t.filter((x) => x.length > 1)
  return (full.length >= 2 ? full : t).sort().join(' ')
}

// WEAK key: first-token INITIAL + last token ("j smith" matches "john smith").
// (Uses original token order, so first/last are positional, not alphabetical.)
const weakNameKey = (name: string | null): string | null => {
  const t = nameTokens(name)
  if (t.length < 2) return null
  return `${t[0][0]}|${t[t.length - 1]}`
}

// ── Root-domain extraction ─────────────────────────────────────────────────────
// Generic hosts many different PIs legitimately share — never a duplicate signal.
const GENERIC_HOSTS = new Set([
  'ucsd.edu', 'providers.ucsd.edu', 'profiles.ucsd.edu',
  'researcherprofiles.org', // UC-wide profile service — many PIs, one host
])

function rootDomain(labUrl: string): string | null {
  let host: string
  try {
    host = new URL(labUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  if (GENERIC_HOSTS.has(host)) return null
  // ucsd.edu subdomains: the SUBDOMAIN host is the meaningful unit (carterlab.ucsd.edu),
  // since the registrable domain (ucsd.edu) is the whole university.
  if (host.endsWith('.ucsd.edu')) return host
  // Elsewhere: registrable domain = last two labels (schoeneberglab.org, lab.github.io -> github.io
  // is a shared host but will be caught by the shared-host heuristic below).
  const parts = host.split('.')
  return parts.length <= 2 ? host : parts.slice(-2).join('.')
}

// ── Union-find for strong groups ───────────────────────────────────────────────
class UF {
  parent = new Map<string, string>()
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x)
    const p = this.parent.get(x)!
    if (p === x) return x
    const r = this.find(p)
    this.parent.set(x, r)
    return r
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b))
  }
}

function keeperOf(members: Row[]): Row {
  return [...members].sort((a, b) => b.chunks - a.chunks || b.sitePages - a.sitePages)[0]
}

function printMember(r: Row, keeper: Row) {
  const mark = r === keeper ? '  ★ KEEP ' : '    drop '
  console.log(
    `${mark}${r.lab_url}\n         pi="${r.pi_name}" dept="${r.department}" school="${r.school}" status=${r.status}` +
      ` | chunks=${r.chunks} sitePages=${r.sitePages} summary=${r.has_summary ? 'Y' : 'n'} apply=${r.has_apply ? 'Y' : 'n'}`,
  )
}

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()

  // 1. All profiles with enrichment flags.
  const profiles = asRows(await sql.query(
    `SELECT lab_url, lab_name, pi_name, department, school, status,
            plain_summary IS NOT NULL AS has_summary,
            apply_info    IS NOT NULL AS has_apply
       FROM lab_profiles`,
  ))

  // 2a. Chunk counts (one query, joined in JS).
  const chunkCounts = asRows(await sql.query(
    `SELECT lab_url, count(*)::int AS n FROM lab_chunks GROUP BY lab_url`,
  ))
  // 2b. Site-page counts: raw_pages keys that are not paper:/fulltext: caches.
  const pageCounts = asRows(await sql.query(
    `SELECT lab_url, count(*)::int AS n
       FROM (SELECT lab_url, jsonb_object_keys(raw_pages) AS k
               FROM lab_profiles WHERE raw_pages IS NOT NULL) t
      WHERE k NOT LIKE 'paper:%' AND k NOT LIKE 'fulltext:%'
      GROUP BY lab_url`,
  ))
  const chunkBy = new Map(chunkCounts.map((r) => [String(r.lab_url), Number(r.n)]))
  const pagesBy = new Map(pageCounts.map((r) => [String(r.lab_url), Number(r.n)]))

  const rows: Row[] = profiles.map((p) => ({
    lab_url: String(p.lab_url),
    lab_name: (p.lab_name as string | null) ?? null,
    pi_name: (p.pi_name as string | null) ?? null,
    department: (p.department as string | null) ?? null,
    school: (p.school as string | null) ?? null,
    status: String(p.status),
    has_summary: Boolean(p.has_summary),
    has_apply: Boolean(p.has_apply),
    chunks: chunkBy.get(String(p.lab_url)) ?? 0,
    sitePages: pagesBy.get(String(p.lab_url)) ?? 0,
  }))
  const byUrl = new Map(rows.map((r) => [r.lab_url, r]))

  // 3. STRONG edges: identical normalized-name key.
  const uf = new UF()
  const reason = new Map<string, Set<string>>() // group -> which signals fired
  const nameBuckets = new Map<string, Row[]>()
  for (const r of rows) {
    const k = strongNameKey(r.pi_name)
    if (!k) continue
    if (!nameBuckets.has(k)) nameBuckets.set(k, [])
    nameBuckets.get(k)!.push(r)
  }
  for (const [, members] of nameBuckets)
    for (let i = 1; i < members.length; i++) uf.union(members[0].lab_url, members[i].lab_url)

  // 4. STRONG edges: shared lab-specific root domain. Heuristic guard: a domain shared
  // by >=3 rows with >=3 DISTINCT PI names is a shared/department host, not one lab.
  const domainBuckets = new Map<string, Row[]>()
  for (const r of rows) {
    const d = rootDomain(r.lab_url)
    if (!d) continue
    if (!domainBuckets.has(d)) domainBuckets.set(d, [])
    domainBuckets.get(d)!.push(r)
  }
  const sharedHostsSkipped: string[] = []
  const domainReview: Array<{ domain: string; members: Row[] }> = []
  for (const [d, members] of domainBuckets) {
    if (members.length < 2) continue
    const distinctPis = new Set(members.map((m) => strongNameKey(m.pi_name) ?? m.lab_url))
    if (members.length >= 3 && distinctPis.size >= 3) {
      sharedHostsSkipped.push(`${d} (${members.length} rows, ${distinctPis.size} PIs)`)
      continue
    }
    // Only union as a STRONG dup when the PI names are at least weakly compatible
    // (same person, maybe spelled differently). Different PIs on one small domain
    // (e.g. two labs on homer.ucsd.edu) is a shared host, not a duplicate — report
    // it separately for eyeballing instead of proposing a merge.
    const weakKeys = new Set(members.map((m) => weakNameKey(m.pi_name) ?? strongNameKey(m.pi_name)))
    if (distinctPis.size > 1 && weakKeys.size > 1) {
      domainReview.push({ domain: d, members })
      continue
    }
    for (let i = 1; i < members.length; i++) uf.union(members[0].lab_url, members[i].lab_url)
    for (const m of members) {
      const root = uf.find(m.lab_url)
      if (!reason.has(root)) reason.set(root, new Set())
      reason.get(root)!.add(`domain:${d}`)
    }
  }
  for (const [, members] of nameBuckets) {
    if (members.length < 2) continue
    const root = uf.find(members[0].lab_url)
    if (!reason.has(root)) reason.set(root, new Set())
    reason.get(root)!.add('same normalized PI name')
  }

  // Collect strong groups (size >= 2).
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const root = uf.find(r.lab_url)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(r)
  }
  const strongGroups = [...groups.entries()]
    .filter(([, m]) => m.length >= 2)
    .sort((a, b) => (a[1][0].pi_name ?? '').localeCompare(b[1][0].pi_name ?? ''))
  const inStrong = new Set(strongGroups.flatMap(([, m]) => m.map((x) => x.lab_url)))

  // 5. WEAK groups: initial+last-name key, only rows not already grouped together strongly.
  const weakBuckets = new Map<string, Row[]>()
  for (const r of rows) {
    const k = weakNameKey(r.pi_name)
    if (!k) continue
    if (!weakBuckets.has(k)) weakBuckets.set(k, [])
    weakBuckets.get(k)!.push(r)
  }
  const weakGroups: Row[][] = []
  for (const [, members] of weakBuckets) {
    if (members.length < 2) continue
    // Drop buckets where all members are already in one strong group together.
    const roots = new Set(members.map((m) => uf.find(m.lab_url)))
    if (roots.size < 2 && members.every((m) => inStrong.has(m.lab_url))) continue
    // Only interesting when the FULL names actually differ in form (else it'd be strong).
    const strongKeys = new Set(members.map((m) => strongNameKey(m.pi_name)))
    if (strongKeys.size < 2) continue
    weakGroups.push(members)
  }
  weakGroups.sort((a, b) => (a[0].pi_name ?? '').localeCompare(b[0].pi_name ?? ''))

  // ── Report ──
  console.log(`lab_profiles: ${rows.length} rows | with chunks: ${chunkBy.size} | statuses: ${JSON.stringify(
    rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {}),
  )}\n`)

  console.log('════════ STRONG duplicate groups (same normalized PI name and/or shared lab domain) ════════')
  let gi = 0
  for (const [root, members] of strongGroups) {
    const keeper = keeperOf(members)
    const why = [...(reason.get(root) ?? new Set(['same normalized PI name']))].join(' + ')
    console.log(`\n[S${++gi}] ${members[0].pi_name ?? '(no pi)'} — ${members.length} rows (${why})`)
    for (const m of members) printMember(m, keeper)
  }
  if (!strongGroups.length) console.log('(none)')

  console.log('\n════════ WEAK matches (first-initial + same last name — review by hand) ════════')
  let wi = 0
  for (const members of weakGroups) {
    const keeper = keeperOf(members)
    console.log(`\n[W${++wi}] ${members.map((m) => `"${m.pi_name}"`).join(' vs ')}`)
    for (const m of members) printMember(m, keeper)
  }
  if (!weakGroups.length) console.log('(none)')

  console.log('\n════════ SAME-DOMAIN, DIFFERENT PIs (shared host, NOT proposed for merge — eyeball) ════════')
  for (const { domain, members } of domainReview) {
    console.log(`\n  domain ${domain}:`)
    for (const m of members) console.log(`    ${m.lab_url}  pi="${m.pi_name}" dept="${m.department}"`)
  }
  if (!domainReview.length) console.log('(none)')

  if (sharedHostsSkipped.length)
    console.log(`\nShared hosts skipped as domain signal (>=3 rows, >=3 PIs): ${sharedHostsSkipped.join('; ')}`)

  const dupRows = strongGroups.reduce((n, [, m]) => n + m.length, 0)
  console.log(
    `\nSUMMARY: ${strongGroups.length} strong groups (${dupRows} rows, ${dupRows - strongGroups.length} would merge away), ` +
      `${weakGroups.length} weak groups.`,
  )
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
