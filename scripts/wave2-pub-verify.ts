export {} // module scope
// WAVE-2 PAPER PIPELINE — VERIFY stage (read-only, NO DB writes). Reads the pub-page harvest
// (candidate DOIs/PMIDs pulled from each lab's OWN publications page by the headless harvester),
// fetches canonical metadata from EuropePMC, and applies the TWO GATES:
//   Gate A (provenance): the id came off the lab's own pub page  — already satisfied by harvest.
//   Gate B (identity):   the PI is an actual author of the canonical record.
// A paper is KEPT only if BOTH hold; anything failing Gate B is dropped+flagged, never guessed in.
// Then ranks the kept set by recency ∪ citations. Emits a human-readable report + a JSON of kept
// papers per lab, for Roman to eyeball before anything is stored.
//   npx tsx scripts/wave2-pub-verify.ts /tmp/pub-harvest.json [--cap 40] [--keep 18]
process.loadEnvFile('.env.local')
import { readFileSync, writeFileSync } from 'node:fs'

async function main() {
  const harvestPath = process.argv[2] || '/tmp/pub-harvest.json'
  const capI = process.argv.indexOf('--cap'); const CAP = capI >= 0 ? Number(process.argv[capI + 1]) : 40
  const keepI = process.argv.indexOf('--keep'); const KEEP = keepI >= 0 ? Number(process.argv[keepI + 1]) : 18
  const harvest = JSON.parse(readFileSync(harvestPath, 'utf8')) as Record<string, {
    name: string; url: string; method: string; source_page: string; dois: string[]; pmids: string[]; titles?: string[]
  }>
  const { fetchWorksByDois, fetchWorksByPmids } = await import('../lib/rag/sources')
  const { nameParts } = await import('../lib/name-match')
  const { withRetry } = await import('../lib/retry')

  // TITLE FALLBACK — for citation-list pages (e.g. Mravic) where papers carry no hyperlinked DOI/PMID,
  // only a quoted title. Resolve via EuropePMC TITLE search, but ACCEPT only when the returned title
  // matches (normalized) so a title never silently resolves to a different paper. The author gate is
  // the second lock downstream.
  const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
  const normT = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  async function fetchWorkByTitle(title: string): Promise<{ title: string; year: number | null; citedByCount: number; doi: string | null; pmid: string | null; authors: { last: string }[] } | null> {
    try {
      const url = `${EPMC}?query=${encodeURIComponent(`TITLE:"${title.replace(/"/g, '')}"`)}&format=json&resultType=core&pageSize=3`
      const data = await withRetry(async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
        if (!res.ok) throw new Error(`EPMC title ${res.status}`)
        return (await res.json()) as { resultList?: { result?: Array<Record<string, unknown>> } }
      })
      const want = normT(title)
      for (const r of data.resultList?.result ?? []) {
        const got = normT(String(r.title ?? ''))
        if (got && (got.includes(want) || want.includes(got)) && Math.abs(got.length - want.length) < 40) {
          const al = ((r.authorList as { author?: Array<Record<string, string>> })?.author ?? [])
          return {
            title: String(r.title ?? ''), year: r.pubYear ? Number(r.pubYear) : null,
            citedByCount: Number(r.citedByCount) || 0, doi: (r.doi as string) || null, pmid: (r.pmid as string) || null,
            authors: al.map(a => ({ last: (a.lastName || a.fullName || '').toLowerCase() })),
          }
        }
      }
    } catch { /* unresolved — dropped, never guessed */ }
    return null
  }

  const report: Record<string, unknown> = {}
  for (const [name, h] of Object.entries(harvest)) {
    const pi = nameParts(name)
    // page order ~ recency; cap the big pages so verification is bounded (recent-first)
    const dois = (h.dois || []).slice(0, CAP)
    const pmids = (h.pmids || []).slice(0, CAP)
    const idWorks = [
      ...(dois.length ? await fetchWorksByDois(dois) : []),
      ...(pmids.length ? await fetchWorksByPmids(pmids) : []),
    ]
    // title fallback ONLY for titles not already covered by a resolved DOI/PMID (keeps it cheap on
    // DOI-linked pages where titles[] is empty anyway)
    const haveTitles = new Set(idWorks.map(w => normT(w.title || '')))
    const titleCands = (h.titles || []).filter(t => !haveTitles.has(normT(t))).slice(0, CAP)
    const titleWorks = (await Promise.all(titleCands.map(t => fetchWorkByTitle(t)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof fetchWorkByTitle>>>[]
    const works = [...idWorks, ...titleWorks]
    // dedup by doi|pmid|title
    const seen = new Set<string>(); const uniq = works.filter(w => {
      const k = (w.doi || w.pmid || w.title || '').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true
    })
    // GATE B: PI surname must appear as an author token
    const kept: typeof uniq = []; const failed: Array<{ title: string; authors: string }> = []
    for (const w of uniq) {
      const authors = (w.authors || []).map(a => (a.last || '').toLowerCase())
      const isAuthor = pi.lastsAll.some(ln => authors.some(a => a === ln || a.split(/\s+/).includes(ln)))
      if (isAuthor) kept.push(w)
      else failed.push({ title: (w.title || '').slice(0, 70), authors: (w.authors || []).slice(0, 4).map(a => a.last).join(', ') })
    }
    // RANK: union of top-recent and top-cited
    const byYear = [...kept].sort((a, b) => (b.year || 0) - (a.year || 0))
    const byCite = [...kept].sort((a, b) => (b.citedByCount || 0) - (a.citedByCount || 0))
    const rankSet = new Map<string, typeof kept[0]>()
    for (const w of [...byYear.slice(0, KEEP), ...byCite.slice(0, KEEP)]) rankSet.set(w.doi || w.pmid || w.title!, w)
    const ranked = [...rankSet.values()].sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, KEEP)

    report[name] = {
      method: h.method, source_page: h.source_page,
      candidates: dois.length + pmids.length + titleCands.length, fetched: uniq.length,
      verified: kept.length, gateB_failures: failed.length, selected: ranked.length,
      selectedPapers: ranked.map(w => ({ year: w.year, cites: w.citedByCount, title: w.title, doi: w.doi, pmid: w.pmid })),
      failures: failed,
    }
    console.log(`\n=== ${name} [${h.method}] ===`)
    console.log(`  candidates=${dois.length + pmids.length} fetched=${uniq.length} verified=${kept.length} gateB-FAIL=${failed.length} selected=${ranked.length}`)
    if (failed.length) for (const f of failed.slice(0, 6)) console.log(`   ✗ DROP: ${f.title}  [authors: ${f.authors}]`)
    for (const w of ranked.slice(0, 8)) console.log(`   ✓ [${w.year}|${w.citedByCount}c] ${(w.title || '').slice(0, 80)}`)
  }
  writeFileSync('/tmp/pub-verify.json', JSON.stringify(report, null, 1))
  console.log('\nwrote /tmp/pub-verify.json')
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
