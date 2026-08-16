export {} // module scope
// WAVE-2 PAPER PIPELINE — GATHER stage (contamination-proof). Replaces the old name-search gather
// entirely. Reads the pub-page harvest (candidate DOIs/PMIDs/titles pulled from each lab's OWN
// publications page by the headless harvester) and turns it into a GatheredLab + bundle in the
// EXACT shape the existing extractor consumes — so the downstream Sonnet extraction + assembleLabV2
// grounding guard run UNCHANGED. Two gates, both required or the paper is dropped+flagged:
//   Gate A (provenance): the id came off the lab's own pub page      — satisfied by the harvest.
//   Gate B (identity):   the PI is an actual author of the canonical record (checked here).
// Ranking is RECENT-WEIGHTED (Roman 2026-08-15): cap to the most-recent candidates, then keep the
// union of top-recent and top-cited within that window. A lab that yields 0 verified papers is NOT
// written — it lands on the failure list for a human to supply a direct pub-page link.
//
//   npx tsx scripts/wave2-pub-gather.ts /tmp/pub-harvest.json [--cap 40] [--keep 18]
process.loadEnvFile('.env.local')
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const OUT_DIR = 'data/wave2-papers'
const REPO = process.cwd()

async function main() {
  const harvestPath = process.argv[2] || '/tmp/pub-harvest.json'
  const capI = process.argv.indexOf('--cap'); const CAP = capI >= 0 ? Number(process.argv[capI + 1]) : 40
  const keepI = process.argv.indexOf('--keep'); const KEEP = keepI >= 0 ? Number(process.argv[keepI + 1]) : 18
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  const harvest = JSON.parse(readFileSync(harvestPath, 'utf8')) as Record<string, {
    name: string; url: string; method: string; source_page: string; dois: string[]; pmids: string[]; titles?: string[]
  }>
  const { fetchWorksByDois, fetchWorksByPmids } = await import('../lib/rag/sources')
  const { fetchEuropePMCFullText } = await import('../lib/papers')
  const { buildBundle } = await import('../lib/rag/extract2')
  const { nameParts, firstNamesEquivalent } = await import('../lib/name-match')
  const { withRetry } = await import('../lib/retry')
  const { INSTITUTE_AFFIL } = await import('../lib/attribution')
  type AuthorWork = Awaited<ReturnType<typeof fetchWorksByDois>>[number]
  const instOf = (u: string) => /sbpdiscovery/.test(u) ? 'sbp' : /salk\.edu/.test(u) ? 'salk' : /scripps/.test(u) ? 'scripps' : /lji\.org/.test(u) ? 'lji' : null

  const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
  const normT = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '')
  // TITLE fallback for citation-list pages (no hyperlinked id) — resolve via EPMC TITLE search,
  // accept ONLY on a normalized-title match so a title never resolves to a different paper.
  async function fetchWorkByTitle(title: string): Promise<AuthorWork | null> {
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
            title: stripHtml(String(r.title ?? '')), type: String(r.source) === 'PPR' ? 'preprint' : 'article',
            year: r.pubYear ? Number(r.pubYear) : null, citedByCount: Number(r.citedByCount) || 0,
            abstract: r.abstractText ? stripHtml(String(r.abstractText)) : null,
            doi: (r.doi as string) || null, pmid: (r.pmid as string) || null, pmcid: (r.pmcid as string) || null,
            isOpenAccess: r.isOpenAccess === 'Y', openAccessUrl: null,
            authors: al.map(a => ({ first: (a.firstName || a.initials || '').toLowerCase(), last: (a.lastName || '').toLowerCase(), orcid: (a.orcid as string) || null, affiliation: '' })),
          } as AuthorWork
        }
      }
    } catch { /* unresolved — dropped, never guessed */ }
    return null
  }

  const failures: Array<{ name: string; url: string; reason: string }> = []
  const summary: Array<Record<string, unknown>> = []

  for (const [name, h] of Object.entries(harvest)) {
    const pi = nameParts(name)
    // nameParts assumes "First Last" and returns EMPTY lastsAll for a single-word name — which for
    // the surname-only LJI labs (Li/Rad/Reina/Schmiedel/Weiskopf) made Gate B reject every paper even
    // though the PI IS an author. Fall back to the single token as the surname (Roman 2026-08-15).
    const surnames = pi.lastsAll.length
      ? pi.lastsAll
      : name.trim().replace(/,.*$/, '').toLowerCase().split(/\s+/).filter(s => s.length >= 2)
    const slug = h.url.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)
    const dois = (h.dois || []).slice(0, CAP)
    const pmids = (h.pmids || []).slice(0, CAP)

    const idWorks = [
      ...(dois.length ? await fetchWorksByDois(dois) : []),
      ...(pmids.length ? await fetchWorksByPmids(pmids) : []),
    ]
    const haveTitles = new Set(idWorks.map(w => normT(w.title || '')))
    const titleCands = (h.titles || []).filter(t => !haveTitles.has(normT(t))).slice(0, CAP)
    const titleWorks = (await Promise.all(titleCands.map(t => fetchWorkByTitle(t)))).filter(Boolean) as AuthorWork[]
    const all = [...idWorks, ...titleWorks]

    // dedup by doi|pmid|title
    const seen = new Set<string>()
    const uniq = all.filter(w => { const k = (w.doi || w.pmid || w.title || '').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true })

    // GATE B — a PI-surname author must be present AND first-name-compatible. Surname-only was too
    // weak: a 32-author collaboration listed "Dan S" Kaufman (a UCSD NK-cell researcher), not the PI
    // "Randal J" Kaufman — surname matched, so it slipped in. Now: keep a paper if SOME PI-surname
    // author's first name is compatible (or absent = honest unknown); drop only if EVERY PI-surname
    // author's first name AFFIRMATIVELY mismatches (Dan≠Randal). DOI-page papers with no EPMC author
    // first name are still kept (provenance already strong). Skipped for surname-only PIs (LJI) where
    // we have no first name to check. (Roman 2026-08-15: "flag/don't add anything that's not theirs".)
    // A single-word PI name (LJI "Weiskopf") has no real first name — nameParts mirrors the surname
    // into `.first`, so we must NOT first-name-gate those (would drop every real paper).
    const singleWord = !pi.lastsAll.length
    const piFirst = (pi.first || '').toLowerCase().trim()
    const havePiFirst = !singleWord && piFirst.length >= 2 && piFirst !== (surnames[0] || '')
    const piInit = piFirst[0] || ''
    const firstVerdict = (authorFirst: string): boolean | null => {
      const af = (authorFirst || '').trim().toLowerCase()
      if (!af) return null                       // no author first name → unknown
      if (af[0] !== piInit) return false          // different first initial → mismatch
      const tok = af.split(/[\s.]+/)[0]
      if (tok.length >= 3 && /[a-z]{3,}/.test(tok)) return firstNamesEquivalent(piFirst, af)
      return true                                 // initials sharing the PI's first letter
    }
    let verified = uniq.filter(w => {
      const mine = (w.authors || []).filter(a => {
        const last = (a.last || '').toLowerCase()
        return surnames.some(ln => last === ln || last.split(/\s+/).includes(ln))
      })
      if (!mine.length) return false             // PI surname not on the paper → not theirs
      if (!havePiFirst) return true              // surname-only PI (LJI) → can't first-name-check
      const verdicts = mine.map(a => firstVerdict(a.first))
      if (verdicts.some(v => v === true)) return true    // a confirmed first-name match
      if (verdicts.every(v => v === false)) return false // ALL mismatch → drop (Dan-S-Kaufman)
      return true                                 // some unknown → honest unknown, keep
    })
    // GATE C (affil-search labs ONLY) — a PubMed author search can pull a same-surname stranger from
    // another institution (a hand surgeon "Osterman AL" vs the SBP microbiologist). DOI-page ids come
    // off the lab's OWN page so they're immune, but esearch results need it. Drop a paper whose
    // PI-surname author carries an affiliation that AFFIRMATIVELY mismatches the institute; keep
    // matches and papers with no per-author affiliation (honest unknown). Belt-and-suspenders to the
    // affiliation-ANDed esearch query in the harvester.
    // Applies to search-based sources (affil-search AND lji-filtered) — both can surface a
    // same-surname stranger from another institution. A different "Patrick Hogan" (same FIRST name,
    // Ranken Jordan Pediatric Hospital) rode LJI's filtered list past Gate B; his affiliation isn't
    // LJI, so the affiliation gate catches what first-name matching can't. DOI-page labs (ids off the
    // lab's OWN page) are exempt — provenance already binds the paper to the PI.
    const inst = instOf(h.url)
    if (/affil-search|lji-filtered/.test(h.method) && inst && INSTITUTE_AFFIL[inst]) {
      const affRe = INSTITUTE_AFFIL[inst]
      verified = verified.filter(w => {
        const mine = (w.authors || []).filter(a => surnames.includes((a.last || '').toLowerCase()))
        const affils = mine.map(a => a.affiliation || '').filter(Boolean)
        if (!affils.length) return true // no affiliation data → honest unknown, keep
        return affils.some(aff => affRe.test(aff)) // keep only if an institute-matching affiliation exists
      })
    }
    // must carry an abstract to summarize from (no abstract → can't ground did/found/used/why)
    const withAbs = verified.filter(w => w.abstract && w.abstract.length > 60)

    if (!withAbs.length) {
      failures.push({ name, url: h.url, reason: verified.length ? `${verified.length} verified but none had abstracts` : `0 papers passed the author gate (method=${h.method})` })
      console.log(`  ✗ FAIL ${name} — ${verified.length ? 'no abstracts' : 'no verified papers'}`)
      continue
    }

    // RECENCY FLOOR — "recent" must be truthfully recent (Roman 2026-08-15): drop anything older
    // than the past 5 years so a highly-cited OLD paper can't sneak in via the citation tail and
    // masquerade as current work. Prolific labs are unaffected (all their recent output clears it);
    // less-prolific labs simply keep fewer, honestly-recent papers.
    const FLOOR = new Date().getFullYear() - 5
    const recent = withAbs.filter(w => (w.year || 0) >= FLOOR)
    if (!recent.length) {
      failures.push({ name, url: h.url, reason: `${withAbs.length} verified papers but none within the last 5 years (>= ${FLOOR})` })
      console.log(`  ✗ FAIL ${name} — no papers within 5 years`)
      continue
    }
    // RECENT-WEIGHTED RANK: union of top-recent and top-cited WITHIN the 5-year window
    const byYear = [...recent].sort((a, b) => (b.year || 0) - (a.year || 0))
    const byCite = [...recent].sort((a, b) => (b.citedByCount || 0) - (a.citedByCount || 0))
    const pick = new Map<string, AuthorWork>()
    for (const w of [...byYear.slice(0, KEEP), ...byCite.slice(0, Math.ceil(KEEP / 3))]) pick.set(w.doi || w.pmid || w.title!, w)
    const selected = [...pick.values()].sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, KEEP)

    // BUILD GatheredLab in the exact shape the extractor consumes
    const sid = (w: AuthorWork) => (w.doi ? `doi:${w.doi}` : w.pmid ? `pmid:${w.pmid}` : null)
    const pages: Record<string, string> = {}
    for (const w of selected) {
      const key = `paper:${sid(w) ?? normT(w.title || '').slice(0, 40)}`
      pages[key] = `TITLE: ${w.title}\nYEAR: ${w.year ?? '?'}\nSOURCE_ID: ${sid(w) ?? ''}\nCITED_BY: ${w.citedByCount}\n\nABSTRACT:\n${w.abstract}`
    }
    // open full text for up to 6 PMCID papers (free EPMC fetch) — richer grounding for chunking
    for (const w of selected.filter(x => x.pmcid).slice(0, 6)) {
      try {
        const full = await fetchEuropePMCFullText(w.pmcid as string, 'PMC')
        if (full) pages[`fulltext:${sid(w) ?? w.pmcid}`] = `FULL TEXT (${w.title}):\n${full.slice(0, 120000)}`
      } catch { /* bonus only */ }
    }
    const g = { labUrl: h.url, piName: name, pages, papers: selected.map(w => ({ title: w.title, year: w.year, sourceId: sid(w) })) }
    const bundle = buildBundle(g as never)

    writeFileSync(`${OUT_DIR}/${slug}.json`, JSON.stringify({ g, bundle, method: h.method, source_page: h.source_page }, null, 1))
    // task file for a Sonnet subagent — PAPERS + SUMMARY only (overview/email are already audited)
    const task = buildTask(name, slug, bundle)
    writeFileSync(`${OUT_DIR}/task-${slug}.txt`, task)

    summary.push({ name, method: h.method, verified: verified.length, selected: selected.length, slug })
    console.log(`  ✓ ${name.padEnd(26)} verified=${verified.length} selected=${selected.length} pmcid-fulltext=${selected.filter(x => x.pmcid).slice(0, 6).length} -> ${slug}`)
  }

  writeFileSync(`${OUT_DIR}/_failures.json`, JSON.stringify(failures, null, 1))
  writeFileSync(`${OUT_DIR}/_summary.json`, JSON.stringify(summary, null, 1))
  console.log(`\ngathered ${summary.length} labs | failures ${failures.length}`)
  if (failures.length) for (const f of failures) console.log(`  FAILURE: ${f.name} <${f.url}> — ${f.reason}`)
}

function buildTask(name: string, slug: string, bundle: string): string {
  return [
    `########## PAPER SUMMARIES — ${name} ##########`,
    ``,
    `You are summarizing one academic lab's papers for a database undergraduates search to find labs to email.`,
    `Work ONLY from the BUNDLE below (each paper's title + abstract, some with full text). For EACH paper:`,
    `- did: the approach/experiment (1-2 sentences)`,
    `- found: the key results, specific/quantitative where the text supports it (1-2 sentences)`,
    `- used: methods / systems / data / techniques (1 sentence)`,
    `- why: significance — what it means and what it is useful for (1 sentence)`,
    `- anchor_quote: ONE verbatim quote COPIED EXACTLY from that paper's text in the bundle (character for character)`,
    ``,
    `HARD RULES: Do NOT store paper titles as findings. Do NOT paraphrase a quote — copy it verbatim. If the bundle`,
    `lacks text to support a field, leave it empty rather than guessing. Summarize ONLY papers present in the bundle.`,
    ``,
    `Then write a SUMMARY for the lab as a whole, grounded in the papers you just summarized:`,
    `- plain_summary: ~100-150 words, for a first-year undergrad with no background — WHAT the lab studies, HOW, and WHY it matters`,
    `- trajectory: 2-4 sentences on where the research is heading, based on the most recent papers`,
    ``,
    `Write TWO JSON files to these EXACT ABSOLUTE paths:`,
    `  ${REPO}/${OUT_DIR}/${slug}.papers.json   -> {"papers":[{"title","year","did","found","used","why","anchor_quote"}, ...]}`,
    `  ${REPO}/${OUT_DIR}/${slug}.summary.json  -> {"plain_summary":"...", "trajectory":"..."}`,
    ``,
    `===== BUNDLE =====`,
    bundle,
    `===== END BUNDLE =====`,
  ].join('\n')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
