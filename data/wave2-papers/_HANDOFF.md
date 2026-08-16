# WAVE-2 PAPER INGEST — HANDOFF (2026-08-16)

Repo: `/home/roman/agent/codebases/labreach`. Read this whole file, then `_health_flags.md`
(the running data-quality log). Everything below is the paper-ingest phase; the institute-profile
layer (emails/lab_urls/overviews for 216 labs) is DONE and committed.

## TL;DR — where we are
- **Pipeline: pub-page-first paper ingest.** Papers come ONLY from each lab's own publications page
  (never name-search), verified by layered gates. This is contamination-proof by design.
- **118 labs gathered** (verified recent paper sets on disk in `data/wave2-papers/<slug>.json`).
- **109 of 118 summarized** (have `<slug>.papers.json` + `<slug>.summary.json`).
- **9 labs remain to summarize** (list below).
- **NOTHING is stored to the DB yet.** The store pass runs AFTER all 118 are summarized.
- Git HEAD at handoff: `42eae2b`. Tests: 44/44. Institute-profile layer untouched by this phase.

## The 9 remaining labs to summarize (wave 13)
```
https_www_scripps_edu_faculty_henderson_    (Scott Henderson — core-facility director, may be thin)
https_www_scripps_edu_faculty_sanna_
https_www_scripps_edu_faculty_topol_        (Eric Topol)
https_www_stowers_lab_com_                  (Lisa Stowers)
https_www_the_park_lab_org_
https_www_willwanglab_com_
https_www_xiaotianlab_org_
https_www_ye_lab_org_
https_yiplab_org
```
NOTE: 3 wave-12 labs (Nimmerjahn, Guldner, Maher) may still be finishing — re-derive the true
remaining set with the command in "Finish the summaries" below, don't trust this static list.

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

## Finish the summaries (wave 13)
1. Get the true remaining set:
```
cd /home/roman/agent/codebases/labreach && npx tsx -e "
const fs=require('fs');const dir='data/wave2-papers';
const caches=fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&!f.includes('.papers.')&&!f.includes('.summary.')&&!f.startsWith('_'));
const todo=caches.map(f=>f.replace(/\.json\$/,'')).filter(s=>!fs.existsSync(dir+'/'+s+'.papers.json'));
console.log(todo.length); for(const s of todo) console.log(s);"
```
2. For EACH remaining slug, spawn ONE Sonnet subagent (model: sonnet). Prompt template:
```
Read /home/roman/agent/codebases/labreach/data/wave2-papers/task-<SLUG>.txt and follow it exactly.
Write both JSON files to the absolute paths named inside. Every anchor_quote MUST be verbatim from
the bundle. Summarize ONLY bundle papers. If a paper is thematically unrelated (possible same-name
author), summarize it but note it. Return counts + any contamination note.
```
   Run ~8-10 at a time (8GB box, no swap). When an agent flags a topic outlier, verify it with the
   sweep in "Verify flags" below before treating it as contamination — so far EVERY agent topic-flag
   was a false positive (legit collaboration or the PI's cross-field work); the gates caught the
   real ones. Session limit resets periodically — if agents fail with "session limit," wait and
   re-run only the labs whose `.papers.json` is missing (idempotent).

## Verify a flagged paper (deterministic, no agents)
`/tmp/verify_flags.ts` (recreate if gone) fetches the flagged paper and prints the PI-surname
author's first name + affiliation. Rule: KEEP if the author's first name matches the PI (or is
absent) AND affiliation matches/absent; DROP only if a different first name OR affirmative
institution mismatch. High-common-surname labs to spot-check: Peng Wu, Sun, Timothy Huang (all
verified legit so far).

## THE STORE PASS (after all 118 summarized) — the careful part
1. **FIRST fix preprint/published dedup.** Several labs (Millar, Parker, Wiseman, Sung Han) list a
   paper twice — a bioRxiv preprint AND its published version, with DIFFERENT DOIs but near-identical
   titles. assembleLabV2's existing dedup collapses by source_id/exact-normalized-title; ADD a
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

## Manual-flag list for Roman (NOT auto-fixable — needs his links/decisions)
Consolidate these into one file for him at the end:
- **21 no-pub-page labs** (harvest found nothing) in `data/wave2-papers/_harvest_failures2.json` —
  Scripps plain-text citation lists (Schimmel/Yates/Lipton/Ghadiri/Wright/etc.), a Cloudflare wall
  (Ocorr), 6 external sites (MacRae/Diercks/Eric Wang/Lamia/Chunlei Wu/Shannon Miller). Needs a
  direct pub-page or Google Scholar link each → then re-harvest those specific labs.
- **~18 no-recent-papers labs** in `data/wave2-papers/_failures.json` — pages expose only pre-2021
  work (Kelly, O'Shea, Mosnier, Weiss, Rosen, Roberts, Srinivasan, etc.). Some are genuinely
  winding-down emeriti; some active-but-stale. Roman decides per lab.
- LJI slight staleness is ACCEPTED (Roman OK'd it) — don't re-engineer.

## Standing rules (Roman)
- No false papers — fail loud, flag, never guess. "Don't add anything that's not that paper."
- Draft-only for any outward action; ask before irreversible things.
- Spawn subagents on Sonnet (not Opus) to save tokens.
- Never delete data — quarantine + status='excluded', reversible.
- No "Co-Authored-By: Claude" trailer in commits.
