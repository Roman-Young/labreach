# WAVE-2 PAPER INGEST — HANDOFF (2026-08-16, updated post wave-13)

Repo: `/home/roman/agent/codebases/labreach`. Read this whole file, then `_health_flags.md`
(the running data-quality log). Everything below is the paper-ingest phase; the institute-profile
layer (emails/lab_urls/overviews for 216 labs) is DONE and committed.

## TL;DR — where we are
- **Pipeline: pub-page-first paper ingest.** Papers come ONLY from each lab's own publications page
  (never name-search), verified by layered gates. This is contamination-proof by design.
- **118 labs gathered** (verified recent paper sets on disk in `data/wave2-papers/<slug>.json`).
- **118 of 118 SUMMARIZED — the summary phase is DONE.** (all have `<slug>.papers.json` +
  `<slug>.summary.json`; verify with the command in "Finish the summaries" below — should print 0).
  Wave 13 (the final 9: Henderson, Sanna, Topol, Stowers, Park, Will Wang, Xiaotian, Ye, Yip) plus a
  separately-discovered pre-existing gap of 9 labs missing only `.summary.json` (Kaufman, Kumsta, Su,
  Talmo Pereira, Mendoza, Ward, Williamson, Wiseman, Kuo-Fen Lee) were both closed out 2026-08-16.
- **All topic-breadth flags raised in wave 13 were verified clean** (0 new contaminants) — see the
  "Wave-13 topic flags" section in `_health_flags.md` for the deterministic-sweep evidence.
- **STORE PASS COMPLETE (2026-08-16).** All 118 stored via `wave2-pub-store.ts --execute`
  (`stored: 118 | flagged: 0`): 112 labs flipped profile→done, +903 paper chunks, +107 summaries,
  0 orphans (no done lab with 0 papers). Embedded (`ingest.ts embed`): 1007 chunks (~$0.03), HNSW
  index rebuilt, 0 unembedded. **Tests 44/44.** DB health-check on Tian/Wiseman/Sacco/Yip: audited
  overview+email INTACT (surgical store held), every paper has a DOI + verbatim quote, 0 quarantined.
- **Code change:** `lib/rag/extract2.ts` published-DOI-preference dedup — COMMITTED `5211ca3`.
- **27 drops APPLIED** (2026-08-16): status='excluded' + chunks quarantined. Reversible.
- **WAVE-14 DONE** (2026-08-16): re-harvested Roman's 11 links → 7 labs stored (Roberto 18, Yang 18,
  Lamia 12, MacRae 8, Teyton 4, Schimmel 2, Diercks 2 = 64 papers), embedded, tests 44/44. Ocorr
  excluded (stale, newest 2020). 3 still fail (Eric Wang/Miller/Wu — JS/Scholar renders, need manual
  DOI lists). See "Wave-14 re-harvest" in `_health_flags.md`.
- **Corpus now: 442 done / 132 excluded / 6 profile.** The 6 profile = the 3 failed-harvest labs +
  Kelly (projects-only) + 2 stragglers — the genuinely-unresolved tail.
- **Still TODO (needs Roman):** (1) manual DOI lists for Eric Wang / Shannon Miller / Chunlei Wu;
  (2) DESIGN DECISION for project-page storage (Wu/Kelly) — see below; (3) audit corpus for
  differently-titled preprint/published near-dups (known dedup limitation).
- Git HEAD before this phase: `42eae2b`. Institute-profile layer untouched throughout.

## PROJECT-PAGE STORAGE — blocked on a product decision (Wu / Kelly)
Roman wants Chunlei Wu's wulab.io project sections + Jeffery Kelly's "ongoing projects" stored as
"writing material" for students. Investigated the full path; it is NOT a simple ingest add:
- **Retrieval** (`lib/rag/retrieve.ts`): filters only `embedding IS NOT NULL AND quarantined=false`,
  NO type filter — so a new `type='project'` chunk WOULD be searchable once embedded. Good.
- **BUT the lab digest** (`app/digest/lab/page.tsx:69`) renders `findings.filter(f => f.type==='paper')`
  ONLY — overview/future-direction chunks are deliberately not shown ("the plain summary covers the
  overview job"). A `type='project'` chunk would be invisible on the lab page without a UI change.
- **AND paperless labs** (Kelly) can't be status='done' — the DB invariant + policy pushes a
  zero-paper lab to 'excluded'. So featuring Kelly's projects needs the zero-paper-'done' rule relaxed.
- **Decision needed from Roman (pick one):** (a) render projects on the digest = new `type='project'`
  chunk (anchor-quote-grounded like papers) + digest UI change + relax zero-paper invariant for
  project-bearing labs; or (b) fold project text into `plain_summary`/`trajectory` (renders today, no
  schema/UI change, but loses per-project structure) — only works for labs that ALSO have papers, so
  Kelly (0 papers) still can't surface. Recommend (a) if projects are a real product feature, else (b)
  for Wu (once his papers harvest) and leave Kelly out. NOT built — do not guess the model.

## Pipeline scripts (all in `scripts/`)
- `wave2-pub-harvest.mjs` — headless Chrome. Reads `data/wave2-papers/_queue.json`, finds each lab's
  pub page, pulls candidate DOIs/PMIDs/titles → `_harvest.json`. DONE; only re-run for flagged labs.
- `wave2-pub-gather.ts` — fetches canonical metadata, applies the GATES + 5-year floor, builds a
  `GatheredLab` cache + bundle + a per-lab Sonnet task file. DONE (last run produced the 118 caches).
- `wave2-pub-store.ts` — SURGICAL store: adds ONLY paper chunks + plain_summary/trajectory, flips
  status→done. NEVER touches the audited overview/email/dept. Dry-run by default; `--execute` to write.

## The gates (already implemented in gather — DO NOT weaken)
Every real contaminant this session was caught by these. Verdicts logged in `_health_flags.md`.
1. **Gate A (provenance):** id came off the lab's OWN pub page (satisfied by harvest).
2. **Gate B (identity):** a PI-surname author must be present AND first-name-compatible
   (firstNamesEquivalent or shared first initial; kept if EPMC has no author first name). Caught
   "Dan S" Kaufman ≠ "Randal J" Kaufman.
3. **Gate C (affiliation, affil-search + lji-filtered labs only):** drop a paper whose PI-surname
   author has an affiliation that affirmatively mismatches the institute (keep matches + no-affil).
   Caught the hand-surgeon "Osterman AL" and a different "Patrick Hogan" (pediatric hospital).
4. **5-YEAR FLOOR:** only papers from `currentYear-5` onward (Roman: "recent" must be truthful).
5. **Grounding guard (in assembleLabV2, runs at store):** drops any paper chunk whose anchor_quote
   isn't verbatim in the bundle — auto-drops stale/empty entries.

## Summaries — DONE. Verify with this before trusting the count:
```
cd /home/roman/agent/codebases/labreach && npx tsx -e "
const fs=require('fs');const dir='data/wave2-papers';
const caches=fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&!f.includes('.papers.')&&!f.includes('.summary.')&&!f.startsWith('_'));
const todo=caches.map(f=>f.replace(/\.json\$/,'')).filter(s=>!fs.existsSync(dir+'/'+s+'.papers.json')||!fs.existsSync(dir+'/'+s+'.summary.json'));
console.log(todo.length); for(const s of todo) console.log(s);"
```
Should print `0`. If it ever prints a nonzero list again (e.g. a future gather adds new labs), the
old workflow still applies: spawn one Sonnet subagent per slug with the prompt template that was
here, run ~8-10 concurrent, verify any topic-outlier flags with `/tmp/verify_flags2.ts` (deterministic
DOI/PMID → author first-name + affiliation/ORCID check — recreate from `_health_flags.md`'s wave-13
entry if gone) before treating a flag as contamination. Every topic-flag across all 13 waves has been
a false positive so far — the gates catch the real contaminants at gather time, not this check.

## THE STORE PASS (all 118 summarized — this is next, NOT started) — the careful part
1. **FIRST fix preprint/published dedup.** Several labs (Millar, Parker, Sung Han, and now confirmed
   Wiseman with 3 pairs: AA147, PDIA1, XBP1s/CMT1B — the largest batch found) list a paper twice — a
   bioRxiv preprint AND its published version, with DIFFERENT DOIs but near-identical titles.
   assembleLabV2's existing dedup collapses by source_id/exact-normalized-title; ADD a
   title-similarity collapse (e.g. normalize title, drop punctuation/preprint-server noise, and if
   two paper chunks share a ≥0.9 normalized-title overlap keep the published/higher-cited one). Do
   this in `lib/rag/extract2.ts` assembleLabV2 (the QB3 DEDUP block) OR as a post-filter in
   wave2-pub-store.ts. Test on Sung Han (3 dup pairs) + Millar (1 pair).
2. **Dry-run the store first:** `npx tsx scripts/wave2-pub-store.ts` (no --execute). Read the output:
   grounded-papers count per lab, any FLAGGED (0 grounded) labs. Spot-check 3-4 rendered labs.
3. **Held-lab check:** Blum, Kendrick, Reynolds, Grotjahn, Sacco, Mahmoud, both Laws, Kuo-Fen Lee
   were wave-1 contamination-HELD (some status='excluded'). The pub-page pipeline got their REAL
   papers. wave2-pub-store flips status→done, which un-excludes them — that's correct now, but
   spot-check each held lab's papers are on-topic before/after (Sacco=muscle stem cells NOT
   head-neck oncology; Blum=Salk chem bio NOT plastic surgery). Verified clean during summaries.
4. **Execute:** `npx tsx scripts/wave2-pub-store.ts --execute`
5. **Embed:** `npx tsx scripts/ingest.ts embed`
6. **Test:** `npm test` (expect 44/44; if a zero-paper lab trips an invariant, set it status='excluded'
   + quarantine its chunks — established policy, never leave a zero-paper lab 'done').
7. **Health-check the DB:** render 3-4 stored labs from the DB (not the cache) as a student would —
   PI/email/overview/summary/trajectory/papers with quotes+DOIs. Confirm audited overview+email
   survived (surgical store guarantee). Query pattern is in the git history (search "rendered from
   the DB" commits).
8. **Commit + push** each meaningful checkpoint. NO "Co-Authored-By" trailer (Roman's standing rule).

## Manual-flag list — ROMAN DECIDED 2026-08-16 (was NOT auto-fixable; now actioned/queued)
Roman triaged all 40 manual-flag labs. Resolution:

**DROP → status='excluded' (27 labs)** — reversible, keeps overview/email, just hidden from students.
His rule: "you don't want to be in an inactive lab papers wise (even if they're actually still active)."
- From harvest-failures (10, incl. Lipton): Juan De La Torre, Martin Friedlander, Chi-Huey Wong,
  Richard Wyatt, John Yates, Amy Lightner, Raymond Stevens, M. Reza Ghadiri, John Griffin,
  **Stuart Lipton** (his only link was a bare `pubmed?term=lipton+s` name-search — breaks Gate A
  provenance, exact vector Gate A exists to stop; Roman chose DROP over the contamination risk since
  his pubs are too old for a student to validly reference anyway).
- From failures (17): Saez, Peter Wright, Qinghai Zhang, Lena Mueller, Anne Bang, Debanjan Dhar,
  Hudson Freeze, Jamey Marth, Kristiina Vuori, Shengjie Feng, Yu Yamaguchi, Clodagh O'Shea,
  Edward Roberts, Laurent Mosnier, Hugh Rosen, Supriya Srinivasan, Friedbert Weiss.
- NOT YET APPLIED — still TODO: flip these 27 to status='excluded' (with a quarantine reason) after
  the 118-store lands. Yip is NOT in this set (see below).

**RE-HARVEST with Roman's links → "wave 14" (11 labs)** — each still needs harvest→gather→summary→store.
Some need headless click-throughs / odd parsing (noted):
- Karen Ocorr: https://www.ocorrlab.org/index.html#Publications — headless click "2020 - Present" tab
- Marisa Roberto: https://www.scripps.edu/roberto/references.html
- Paul Schimmel: https://www.scripps.edu/schimmel/publications_schimmel.html
- Luc Teyton: https://www.scripps.edu/teyton/publications.html (+ Research page; has 2021 pubs)
- Katja Lamia: https://www.ncbi.nlm.nih.gov/sites/myncbi/katja.lamia.1/bibliography/40440719/public/
  (NIH MyNCBI self-curated bibliography — provenance OK but unusual format, parse carefully)
- Christian Diercks: https://www.dierckslab.com/general-5
- Eric Wang: https://www.ewanglab.com/publications — headless click "2022-Present" tab
- Ian MacRae: 3 research-focus pages, each with SELECTED pubs for that focus (Roman: grab the pubs
  he emphasizes): /protein-and-rna-structure-1, /rational-rna-therapeutics, /copy-of-rna-therapeutics
  on macraelab.org — PAPER re-harvest (not a project-parse).
- Shannon Miller: https://www.millerlabresearch.com/publications
- Xiang-Lei Yang: https://www.scripps.edu/yang/publications_yang.html
- Chunlei Wu: https://scholar.google.com/citations?user=EmD8988AAAAJ (his Scholar profile — recents).

**PROJECT-PAGE parse → NEW content type, storage model UNDECIDED (2 labs)** — parked pending design:
- Chunlei Wu: wulab.io has cool per-project sections (headless: click menu → traverse projects) —
  Roman wants project descriptions stored as writing material (in ADDITION to his Scholar papers).
- Jeffery Kelly: https://www.scripps.edu/kelly/ — no pub page, but an "Ongoing projects in the Kelly
  Laboratory include:" section with traversable links; parse + store those (projects-only, no papers).
  OPEN QUESTION for Roman: where does project content live? (proposed: new type='project' chunk,
  anchor-quote-grounded like papers; build plain_summary from projects for paperless labs). Decide
  before building — it touches scrape→assemble→store→retrieval.

**Yip: NOT a drop.** He's in `_failures.json` (stale — early homepage harvest failed) but a later
yiplab.org pub-page harvest succeeded; summarized 2026-08-16, part of the 118-store. Ignore that entry.

- LJI slight staleness is ACCEPTED (Roman OK'd it) — don't re-engineer.

## Preprint/published dedup — RESOLVED 2026-08-16 (no new code path needed)
The existing QB3 dedup ALREADY collapses preprint+published pairs: both title-variants resolve to one
`sourceId` via the titleToSid map, so the sourceId-keyed dedup catches them (verified: 0 surviving
normalized-title dups on Wiseman/Sung Han/Millar/Parker). The ONLY gap was *which* DOI survived —
order-dependent, so 1 of Wiseman's 3 pairs kept the bioRxiv preprint over the published Brain paper.
FIX LANDED in `lib/rag/extract2.ts` assembleLabV2: the titleToSid build now prefers a published DOI
over a preprint (10.1101 bioRxiv/medRxiv, 10.26434 ChemRxiv, 10.21203 Research Square) for the same
normalized title. Verified `avoidable=0` (no lab keeps a preprint when a published version exists);
remaining preprint cites are genuine preprint-only papers. Tests 44/44.

## Standing rules (Roman)
- No false papers — fail loud, flag, never guess. "Don't add anything that's not that paper."
- Draft-only for any outward action; ask before irreversible things.
- Spawn subagents on Sonnet (not Opus) to save tokens.
- Never delete data — quarantine + status='excluded', reversible.
- No "Co-Authored-By: Claude" trailer in commits.
