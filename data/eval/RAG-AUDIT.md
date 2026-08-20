# RAG audit + final architecture (2026-08-20)

Written after Roman called a halt: *"We are doing so much finetuning, it feels like we are plateauing
or overfitting. With every little nudge we get losses in other areas."*

**This document supersedes DECISIONS.md as the decision record.** DECISIONS.md is kept as the
evidence appendix (raw numbers per experiment); read this file for what is TRUE and SHIPPED.

---

## The audit finding: we never overfit, because we never shipped a retrieval change

15 RAG commits. Exactly one touched production retrieval behavior (the expansion arm) and it was
OFF by default. Every tuning constant is still at its original value:

| knob | value | ever changed? |
|---|---|---|
| `RRF_K` | 60 | no (SIGIR default) |
| `CANDIDATES` | 80/arm | no |
| `EF_SEARCH` | 200 | no |
| `scoreDecay` | 0.5 | no |
| `scoreTopN` | 5 | no |

What actually happened: ~6 improvements were proposed, measured, and **all were rejected by the
eval**. That is the gate working correctly, not overfitting. But the process burned enormous cycles
and left real mess (63 untracked experiment scripts; dead code in the hot path).

**Conclusion: retrieval is at a good local optimum. Further tuning is negative expected value.
Retrieval is now FROZEN.**

---

## Rejected changes (do not revisit without new evidence)

| change | why rejected | measurement |
|---|---|---|
| **Query decomposition** (per-interest sub-queries) | Lost to a config value that already existed | 13/18 vs 16/18 for simply showing more labs |
| **Two-sided arm ranking** (interests vs experience) | Traded away top-of-list quality — backwards from the goal | P@5 60%→50% |
| **"Matched both arms" boost** | Degenerate signal — 25/30 top labs hit both arms, carries ~no information | — |
| **Recency boost** | Reorders without adding valid labs; contradicts the recall objective | not run |
| **Reranking** | A precision tool; there is no precision problem | not run |
| **Query expansion** (chip → jargon) | Net negative on the broad chips the product actually sends | R@20 71.8%→65.8% |
| **Embedding `plain_summary`** | Would inject our own generated prose into the retrieval signal, breaking the "every hit is real, quotable lab evidence" guarantee (Roman's call — correct) | not run |

Pattern across all of them: **the corpus/product is broader and messier than any synthetic test, and
gains measured on narrow hand-built queries evaporate on real ones.** Four separate times, realigning
the eval to the real product shape reversed a conclusion.

---

## The shipped architecture (frozen)

Deliberately minimal — every added component was measured and failed to beat this.

```
student input ─→ interests[] (17 fixed UI chips, max 5, verbatim)
                 resume      (free text → distillProfile, LLM-condensed)
                        │
                        ▼
              one blended query string
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
   DENSE arm                       SPARSE arm
   pgvector HNSW cosine            Postgres FTS, OR'd lexemes
   gemini-embedding-001 @768d      ts_rank_cd
   80 candidates                   80 candidates
        └───────────────┬───────────────┘
                        ▼
              RRF fusion (k=60, rank-based)
                        ▼
        lab aggregation: Σ rrf_i · 0.5^i  (top 5 chunks)
              → best chunk full weight, extras diminish
                        ▼
              student's slider (5–30, default 15)
                        ▼
              STUDENT is the final reranker (stars what they like)
```

**Why each piece earns its place:**
- **Hybrid, not dense-only** — a real miss drove it: a "mismatch repair" lab ranked below generic
  "yeast" hits on dense alone.
- **RRF over score-blending** — fuses on RANK, so the dense (0–1) and sparse (unbounded) scales never
  need reconciling; the arm-drowns-arm failure mode is structurally impossible.
- **Decay-weighted aggregation** — a lab with one bullseye paper stays competitive with a lab that has
  many moderate hits. (Both extremes were considered and rejected on principle: max-passage is too
  flat, plain-sum buries specialists.)
- **No reranker** — the student reranks by starring. Adding a model here optimizes a metric nobody
  needs.

---

## What is actually load-bearing (keep, maintain)

1. **Corpus quality** — this is the moat and where the real value was created: 445 labs, verbatim-
   quote grounding, contamination gates (Gate A provenance / B identity / C affiliation), 5-year
   recency floor, near-dup collapse. Retrieval quality follows corpus quality.
2. **Embedding version guard** — `embedding_model` stamped per row + a DB invariant. Prevents a
   silent recall collapse if `EMBED_MODEL` is ever bumped without a full re-backfill. Zero runtime
   cost, real bug class prevented.
3. **Attribution eval** (`eval-rag.ts attribution`) — autonomous, no labels, ~60 labs: can each lab
   be found from its own paper? **Baseline: top-5 98.4%, top-10/20 100%.** This is the regression
   gate that matters; run it after any corpus or embedding change.
4. **DB invariants** (`npm test`, 45 tests) — no orphan chunks, no unembedded live chunks, no
   excluded lab leaking, quarantine ledger coverage.

## What is NOT load-bearing (do not invest further)

- **The relevance golden set** (`golden-retrieval.json`, 4/25 profiles labeled). Keep as a coarse
  canary; **do not treat as an optimization target and do not label the remaining 21.** At n=4 it is
  underpowered — it produced differently-signed answers on consecutive experiments, which is what
  finally exposed the tuning treadmill. Its real value was diagnostic (it found the input-shape bug),
  not as a score to maximize.
- **The 63 untracked `scripts/_*` experiment files.** Pure cruft. Delete freely (`rm` was sandbox-
  blocked for the agent; a human can clear them).
- **`lib/rag/interest-expansion.ts`** — orphaned, nothing imports it, marked REJECTED. Safe to delete.

---

## FINAL BUILD — distiller selection fix (2026-08-20, shipped)

The last input-path bug, and the close of the project. `distillProfile` excluded
"software/databases/infrastructure" as noise — correct for a wet-lab student listing `Python, Excel`,
catastrophic for a student whose research IS the software. A bioinformatics resume came back **100%
empty**, so the query was chips-only and the perfect-match lab (Wu/BioThings) ranked **>30**.

**Fix (Roman's design): SELECT, don't REWRITE.** The distiller filters out noise and hands survivors
through unchanged. The keep/drop test is now *"is this a PROJECT or a bare LIST?"* rather than *"is
this software?"* — one principle instead of an exception list that would grow with every newly-found
broken segment. Enforced in code by `selectVerbatimSpans()` (drops any span not present verbatim in
the resume), mirroring the anchor-quote GROUNDING GUARD in `extract2.ts` — *enforce, don't trust the
prompt*. Bundled: retry depth 2→4 (503s were failing whole digest requests) and a `NONE` sentinel that
tolerates trailing punctuation.

### Results

**Core promise — `scripts/eval-similar-work.ts`** (student-voice descriptions of similar work; the
guarantee the product actually sells):

| | before | after |
|---|---|---|
| rank #1 | 6/8 | **7/8** |
| top-5 | 7/8 | **8/8** |
| visible at default slider | 7/8 | **8/8** |

**Wu went >30 → #1. Nothing regressed.** Every lab is now findable by a student who did similar work.

**Archetype sweep — `scripts/eval-distill.ts`** (12 student types; the systematic check that no
segment is silently broken). 11/12 clean; filtering demonstrably works on realistic noisy resumes:
industry-intern kept 57% (dropped "managed the team's inventory spreadsheet"), wet-lab 71% (dropped
GPA + coursework), noise-only → nothing. Verbatim-subset confirmed throughout (100% retention for
neuro/chem/ecology/theory/engineering — i.e. it copied rather than rewrote).

One flag investigated and **closed as correct behavior**: `coursework-only` (a first-year with only
classes + a pre-med club) contributes nothing from the resume — there genuinely is no research signal
— and still gets a usable interests-only query, **not** a 422. A first-year *with* a real science
project has it preserved verbatim (rule 4 fires). Both verified by hand.

**Distiller A/B (`relevance` vs `--raw`): INCONCLUSIVE BY CONSTRUCTION — do not cite it either way.**
71.0% vs 71.4% Recall@20 (distilled better on R@10: 49.7% vs 45.1%). The golden-set profiles are
one-sentence resumes with no noise in them, so there is nothing for a filter to remove and raw ≈
distilled trivially. The evidence that the distiller earns its keep is the archetype sweep above, not
this number.

**Test coverage:** `tests/distill.test.ts` — 12 known-answer tests for the pure guard (exact copies
kept, typography normalized, **rewrites dropped**, fabrications dropped, short fragments dropped, the
software-resume regression pinned). First-ever coverage for the distiller, and it needed **no mocking
scaffolding** — which is precisely why the guard was extracted as a pure function.

### Gate results — all green

| gate | result |
|---|---|
| Unit tests | **57/57** (45 existing + 12 new) |
| Typecheck | clean |
| Similar-work | **7/8 at #1, 8/8 top-5** (floor 7/8) — Wu recovered |
| Attribution | **98.4% top-5, 100% top-20** — unchanged |
| Wet-lab control | Sacco / Sung Han / Roberto all still #1 — **no regression** |
| Relevance | 71.0% (baseline 71.8%, flat within noise on the underpowered n=4 set) |

The revert rule was not triggered.

---

## The one real bug this whole effort found (and fixed)

`distillProfile` takes `{interests[], resume}` — interests are prepended **verbatim**, the resume is
LLM-condensed and, by design, drops forward-looking aspirations ("I want to study X" is not
experience). The eval had been jamming everything into `resume`, so stated interests were silently
discarded. Fixed. Mechanism-verified, not a metric wobble: **Kersten #20→#1, Hui #22→#6, with zero
retrieval-code change.**

That single fix was worth more than every ranking experiment combined — and it was a *plumbing* bug,
not a tuning problem. **Where to look next time: the input path, not the ranking math.**

---

## Known limitations (accepted, documented, not bugs)

- **Chip taxonomy is coarse.** "Genetics, genomics & epigenetics" lumps gene-editing + genomics +
  epigenetics; no chip fits circadian biology (p17) or general cell biology (p18). This — not
  retrieval — is why some niche labs (e.g. Komor, base editing) rank low. Fix if ever needed = a
  finer chip list, a **product/UI decision**, not a retrieval change.
- **Paper-hook recall is the weakest tier** (~50-75%): a strongly-relevant single paper inside a
  thematically divergent lab. Klemke missed under every scheme tried. If this ever matters, the
  direction is surfacing the matching CHUNK, not more query manipulation.
- **Marquee labs can rank mid-pack** because they write field jargon, not the umbrella term a student
  types (Cravatt: "chemical biology" appears in 0 of his 19 chunks). Mitigated in practice by the
  student's 5–30 slider. Query expansion was the attempted fix and it made things worse overall.

---

## If you touch RAG again, the rule

Run these before and after — the first two are fast and need no network:

```bash
npm test                                  # 57/57
npm run typecheck
npx tsx scripts/eval-similar-work.ts      # core promise: >=7/8 at #1
npx tsx scripts/eval-rag.ts attribution   # regression gate: top-5 >=98%, top-20 100%
npx tsx scripts/eval-distill.ts           # only if you touch distill.ts
```

**Do not tune against the 4-profile relevance set** — it is not powered for it, and chasing it is
what produced the tuning treadmill. If a change cannot be justified by a *mechanism* — as both real
bugs were (input shape, then selection-vs-rewrite) — and only by a metric delta on a handful of
profiles, **do not ship it**. Every one of the six ranking-math changes that looked good by metric
alone was later shown to be noise or a regression.
