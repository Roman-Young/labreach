# Phase B — Two-Depth Cached Research, Digest-First

**Date:** 2026-07-17
**Status:** Design — pending user review
**Branch:** feature/lab-digest

## Problem

Two flows do research independently:

- **Digest** (`getLabResearchBundle`) — homepage + up to 4 PubMed **abstracts**, grounded, cached in KV for 60 days. Abstract-only: too thin for the specific, non-transferable connections the product promises.
- **Writer** (`runAgent` + `tools.ts`) — an autonomous 12-iteration Gemini tool-loop that re-researches *from scratch on every draft*, uncached. It is the only place full-paper text is read (via a Firecrawl scrape of the PMC HTML page). It is slow, non-deterministic, and blows past `/api/research`'s 60s limit.

The writer re-doing uncached research is the latency/cost problem. The digest being abstract-only is the depth problem. Both are solved by one move: **make a single cached research pass the source of truth for both flows, and give it real depth — read on demand.**

## What the eval data forces

- Corpus eval (commit `5ad7f5f`): **judged email quality does not predict replies.** So deep research must NOT be justified as "better emails → more replies." No reply prediction anywhere (existing honesty line).
- The writer is prohibited from using Methods/Results depth (resume-dumping, above-level jargon, teaching the PI their own work are all banned; a `none`-experience student cannot credibly deploy Methods detail). So of the deep content:
  - **Discussion / Future-Directions → usable in the email** (open problems = level-appropriate curiosity). This is the email-relevant deep material.
  - **Methods / Results → serve the student's *understanding* and the *digest*, not the draft.**
- Therefore the deep-read is justified as a **digest capability** (screening + understanding), with the writer as a downstream consumer. The digest is the primary product (`Phase A` commit).

## The real user job

"I have 40 lab tabs open — which handful do I invest in, and why?" That is **screening + understanding**, not email composition. The email is the easy last mile. The design serves screening first.

## Design

### Two research depths, selected by intent

1. **Screening depth** — batch digest, up to 25 labs, 2-wide. Homepage scrape + recent abstracts + an **activity signal** (recent-paper cadence). Cheap, fast, cached. Runs for every pasted lab.
2. **Deep depth** — fires only when the user commits to a lab (drill-in or "Write this one"). Screening content + **free full-text** of the lab's own recent open-access papers → Discussion/Future-Directions/Results/Methods → grounded findings + `openProblems`. Cached, so paid once.

Both write to the same cached `LabResearchBundle` (keyed by lab URL, no student data). A `depth` marker records screening vs. deep. Drilling into a screening-level lab **upgrades** the bundle to deep and re-caches. Screening 25 labs never pays the full-text cost; only the labs a user actually opens go deep.

### One research function

```
getLabResearchBundle(labUrl, { depth: 'screening' | 'deep' }): LabResearchBundle
```

- Cache hit at ≥ requested depth → return cached.
- Cache hit at lower depth than requested → upgrade (deep-read), re-cache, return.
- Miss → build at requested depth, cache, return.

Digest calls `screening`; drill-in and the writer call `deep`.

### Deep-read mechanics

- **Paper selection (disambiguation + relevance):**
  - *Prefer papers linked from the lab's own homepage / publications page* — provenance is the page itself, which resolves most of the same-name problem.
  - Fallback: PubMed name search **constrained by institution** (from the lab domain / homepage), verifying the PI appears in the author list.
  - **Relevance-first:** pick 2–3 papers whose titles/abstracts best match the student's interests / lab focus *before* spending a full-text read.
- **Full text (free, no Firecrawl):** `getPMCID(pmid)` → if in the PMC open-access subset, `efetch.fcgi?db=pmc&retmode=xml` returns structured JATS. Parse sections; keep **Discussion / Future-Directions / Results / Methods** with a **per-section token budget** (Discussion prioritized — best hook material). Non-OA → abstract only, marked.
- **Extraction + grounding:** findings, `openProblems` (from Discussion/Future-Directions, section-provenance enforced), methods, significance, extrapolations, glossary. **Verbatim grounding on every quote** (unchanged — the anti-fabrication backbone). Provenance tags: paper + year + section, OA-vs-abstract marker.

### Activity signal (new — highest value-to-cost)

Package existing `publicationVolume` / `mostRecentPaperYear` into an explicit "is this lab active / likely recruiting?" read on the digest card: most-recent-paper year, papers-in-last-3-years bucket (existing `floodNote`), and a plain-language active / quiet / dormant label. **Activity ≠ reply likelihood — stated honestly, no prediction.** Mostly repackaging fields already computed.

### Writer changes (retire the loop)

`runAgent` becomes: `getLabResearchBundle(url, { depth: 'deep' })` → `bundleToEvidence(bundle)` (pure) → `writeEmail` → evaluate → revise.

- **Retire:** the 12-iteration tool-loop, `tools.ts` (tool schemas + `executeTool`), `checkEvidenceQuality`, the in-loop `verifyGrounding` re-check, the research system prompt in `prompts.ts`.
- **Keep:** `writeEmail`, `evaluateDraft` + `buildCritique` + the revise loop (the one agentic loop worth its cost), `grounding.ts`, `prohibitions.ts`, `structure-check.ts`.
- No capability is lost — full-paper reading moves into the bundle builder and gets cheaper (efetch) and more reliable (JATS sections vs. regex on scraped markdown). What's lost: Gemini improvising an unplanned fetch. Accepted trade — that improvisation is the uncached, unrepeatable slowness.
- `/api/research` `maxDuration` → **300** (cold-lab drafts build the deep bundle inline); stale comment corrected.
- The draft page already passes the digest's bundle via `sessionStorage`; wire it through so a digest→write handoff skips re-lookup.

### Firecrawl budget

Firecrawl only for the homepage, once per lab per 60 days, and only when needed. Everything else on free eutils, parallelized. Add a free **NCBI API key** (3→10 req/s) to make parallel paper fetches safe. Net: Firecrawl usage *drops* vs. today because full-text leaves Firecrawl entirely.

### Data model

`LabResearchBundle` gains:
- `openProblems: LabFinding[]` — grounded Discussion/Future-Directions quotes, distinct from model-generated `extrapolations`.
- `depth: 'screening' | 'deep'`.
- an activity summary (label + the existing volume/year fields packaged).
- sources may carry `sourceType: 'pubmed_full_text'` + OA/abstract marker.

Bump `BUNDLE_KEY_PREFIX` → `v4:` to invalidate abstract-only cached bundles.

`bundleToEvidence(bundle): ResearchEvidence` — pure adapter: findings→candidateFindings, openProblems→openProblems, methods/specifics→otherQuotableSpecifics.

## Explicitly out of scope (later specs)

- **Lab discovery** (find labs for the user, not just screen pasted URLs) — the actual top-of-funnel killer feature and acknowledged **north star**; needs a search/entity integration. Named here so v1 doesn't architect it out.
- **Related-topic / cross-lab synthesis** — v2, behind a grounding guardrail (related work informs understanding only; never quoted as this lab's finding).
- **Plain-fetch-before-Firecrawl tier** — measure Firecrawl usage first, add if it's actually a cost.
- **Second-pass LLM verifier** — verbatim grounding already covers fabrication; add only if drift appears.

## Testing (all free — Gemini + eutils, no Firecrawl/Anthropic)

- Unit: `bundleToEvidence` (pure); JATS section parser (XML fixture); relevance selection (fixtures); homepage-pub-list preference (fixtures); activity-label logic (fixtures).
- End-to-end on already-cached labs: digest screening → activity signal appears; drill-in on a lab with an OA paper → Discussion-sourced grounded findings + `openProblems` appear, bundle upgrades to deep + caches; writer drafts from the cached deep bundle with **zero** scraping.

## Sequencing (shippable increments)

1. Data model (`openProblems`, `depth`, activity field) + `bundleToEvidence` adapter (pure, tested); bump cache to `v4`.
2. Free efetch full-text + JATS section parser in `pubmed.ts` (fixture-tested); replaces the Firecrawl PMC scrape.
3. Two-depth `getLabResearchBundle(labUrl, { depth })` with relevance-first selection + homepage-pub-list preference; wire screening → digest, deep → drill-in.
4. Activity signal packaging + digest card UI.
5. Retire the writer loop: `runAgent` consumes the deep bundle; delete `tools.ts` / `checkEvidenceQuality` / research prompt; `maxDuration` → 300; draft page passes the bundle through.
6. End-to-end verify on cached labs.

Each step is a real increment that can be stopped after. This is a multi-session piece and remains lower-urgency than PEPMatch #28 and the Seurat work — late-night-block material.
