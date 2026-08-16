# RAG retrieval eval (checklist item 1)

Turns "eyeball 12 queries" into numbers you can gate changes on. Runner: `scripts/eval-rag.ts`.

## Two evals

**Attribution self-consistency** — `npx tsx scripts/eval-rag.ts attribution`
Auto-generated from DB truth, no labels. For a deterministic sample of ~60 `done` labs, it queries
with one of the lab's OWN paper summaries and checks the lab surfaces in the top-K. A floor guard:
if the index/dedup/quarantine/embedding/ranking work regresses, a lab stops being findable from its
own papers. Current baseline (2026-08-16): **top-5 98.4%, top-10/20 100%** over 64 labs. Floor: 90%
in top-20 (exits nonzero below it).

**Relevance (Recall@20 / Recall@10 / MRR)** — `npx tsx scripts/eval-rag.ts relevance`
Runs the REAL Stage-A path (`distillProfile` → `retrieveLabs`) over a human-labeled golden set of
realistic student profiles → genuinely-good labs. `--raw` skips the distiller. Provisional floor:
mean Recall@20 ≥ 70% (tune once the first baseline is known).

## Building / updating the golden set (the one human step)

CRITICAL — avoid pool bias. The `goodLabs` answer key must NOT be limited to the labs current
retrieval already returned. If it is, you can only ever measure "of what retrieval found, which is
good" and can never catch a false negative (a great lab ranked #200 or missed entirely) — the exact
thing Recall exists to measure. So `candidates` are just a memory aid; the real ground truth is your
judgment, and the labs you add that retrieval MISSED are the most valuable entries in the set.

1. `npx tsx scripts/eval-rag.ts draft` → `golden-retrieval.draft.json`: the 25 profiles (edit the
   `PROFILES` array to change them) each with the top labs current retrieval returns as `candidates`.
2. For each profile, decide the genuinely-good labs. Pull the right ones from `candidates`, AND —
   to find matches retrieval ranked low or missed — use the retrieval-INDEPENDENT lexical search:
   `npx tsx scripts/eval-rag.ts find "cancer immunotherapy T cell exhaustion"`
   It searches the actual paper/overview text across all 445 labs (not the dense/RRF path under
   test), so you can add any lab by its lab_url regardless of where the eval'd retriever put it.
   You don't need to be exhaustive — ~3–6 clearly-good labs per profile (including the missed ones)
   is enough for a meaningful metric.
3. Put the chosen lab_urls in each profile's `goodLabs`; save as `golden-retrieval.json` (drop the
   `candidates`/`_instructions` keys).
4. `npx tsx scripts/eval-rag.ts` → runs both evals, prints metrics, exits nonzero if below floor.

## When to run

Before merging anything that touches retrieval, ranking, embeddings, distillation, or the corpus
(dedup, re-ingest, a new institution). It's the regression gate; the unit suite (`npm test`) stays
fast and DB-structural, this is the slower networked quality check run on demand / pre-deploy.
