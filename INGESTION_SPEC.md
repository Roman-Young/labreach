# LabReach Ingestion — Design of Record (v2)

Owner: Kairo (CTO). Status: active redesign. Supersedes the atomic-quote chunk model.

## Why v2 (what v1 got wrong)

v1 proved the *plumbing* (reliable batch, caching, resumable queue, 61 labs ingested) but the
*data* is not good enough to ship, and we only learned that by inspecting output after building:

1. **Chunks are 1-line quotes.** "LongTR showed 84.7% concordance" is not something a student can
   build a hook from. The DB must hold, per paper, **what the lab did / found / used / why it
   matters** — a real summary, quote-anchored, not an atomized fragment.
2. **Noise:** paper *titles* were stored as "findings."
3. **Broken provenance:** sources truncated to `.../PMC` — not traceable to the paper.
4. **Incomplete cache (bug):** PubMed abstracts are NOT written to `raw_pages`, so website-less
   labs' source text isn't fully cached — violating "every lab must be re-extractable from cache."

Root cause of all the backwards motion: **no quality spec, no measurement.** v2 fixes the process,
not just the code.

## The quality bar (what "good" means — measured, not asserted)

A lab record is good when, for the lab's ~5 most recent + ~2 most-cited papers, we have a
**per-paper structured summary**: `did` / `found` / `used` / `why_it_matters` (1–3 sentences each),
each backed by a **verbatim anchor quote** and a **traceable source id** (DOI or PMID), plus a
**lab overview** (from the About page where one exists). Measured by `scripts/audit.ts`:

- **Quote fidelity** — anchor quote appears verbatim in the cached source. Target ≥ 95%.
- **Source traceability** — source_id resolves to a real DOI/PMID. Target 100%.
- **Coverage** — ≥ 5 papers summarized for a PI with ≥ 5 papers. Target ≥ 90% of labs.
- **Richness** — mean summary ≥ ~80 words across did/found/used/why (not a title).
- **Connectability (LLM-judge, cheap)** — "could a student form a specific hook from this?" ≥ 4/5.

We do not run the full batch until a 15–20-lab sample clears this bar.

## Architecture — deterministic gather → static extract (replaces the agentic loop)

The agentic multi-turn loop is the flaky, expensive part (the "finisher" problem, ~10 Gemini
calls/lab). Papers are now reachable directly via API, so we don't need an agent to *navigate*:

**`gatherLab(labUrl, piName)` → bundle (all cached to `raw_pages`):**
1. OpenAlex author search (UCSD-scoped) → dedupe, pick ~5 most-recent + ~2 most-cited, with abstracts.
2. For those papers: full text where open-access (PMC → Europe PMC fallback).
3. Scrape homepage; follow ONE About/Research link and scrape it. (Only ~2 Firecrawl calls/lab.)
4. **Every source string → `raw_pages` (cache-everything).**

**`extractLab(bundle, meta)` → one static structured Gemini call →** per-paper summaries + overview
+ lab facets (modality/recruiting/techniques/organisms/areas for the ranker).

Why this is better: cheaper (~1–2 Gemini calls + ~2 Firecrawl vs ~10 + ~5), reliable (no finisher),
fully cached, and re-extraction is free. We keep the old agentic path available but default to this.
Validated against the audit + bake-off before committing.

## Data model (v2 chunks)

`lab_chunks`: one row per **paper** and per **overview** (+ optional future_direction):
`kind ('paper'|'overview'|'future_direction')`, `title`, `year`, `content` (woven ~120–200-word
summary — the embeddable unit), `anchor_quote` (verbatim proof), `source_label`, `source_id`
(DOI/PMID — traceable), `meta jsonb {did,found,used,why}` (for digest rendering), `content_tsv`,
`embedding` (embed step). Lab-level facets stay in `lab_profiles`.

## Plan (phased — instrument first, spend last)

- **P1 — Instrument & fix (this phase, cheap):** cache-everything fix; `scripts/audit.ts` quality
  harness; v2 schema migration. Re-extract the 61 cached labs (static, ~$4) → first audit baseline.
- **P2 — Redesign extraction:** the gather→static pipeline + per-paper-summary schema + About scrape.
- **P3 — Bake-off (multi-agent, free over cache):** 2–3 extraction designs × the same ~5 cached
  labs × judge panel scored on the bar above → pick + integrate the winner. Iterate to the bar.
- **P4 — Full batch** (~312 labs) once the sample clears the bar. Then embeddings (T87) → digest.

## Cost (measured)

Full batch ≈ Gemini ~$30–50 (less than v1 — fewer calls) + Firecrawl ~2–3 credits/lab. Re-extraction
over cache ≈ $0.06/lab, $0 Firecrawl — so P1/P3 iteration is nearly free. Top up Firecrawl to ~2,000.
</content>
