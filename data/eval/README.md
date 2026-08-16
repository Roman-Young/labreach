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

1. `npx tsx scripts/eval-rag.ts draft` → writes `golden-retrieval.draft.json`: the 25 profiles
   (edit/extend the `PROFILES` array in `scripts/eval-rag.ts`) each with the 12 labs current
   retrieval returns, in a `candidates` list.
2. For each profile, move the lab_urls that are GENUINELY good matches from `candidates` into
   `goodLabs` (delete the rest; add any obvious lab retrieval missed). Your judgment is the truth —
   `candidates` are just a starting point, some right, some wrong.
3. Save the curated file as `golden-retrieval.json` (drop the `candidates`/`_instructions` keys).
4. `npx tsx scripts/eval-rag.ts` → runs both evals, prints metrics, exits nonzero if below floor.

## When to run

Before merging anything that touches retrieval, ranking, embeddings, distillation, or the corpus
(dedup, re-ingest, a new institution). It's the regression gate; the unit suite (`npm test`) stays
fast and DB-structural, this is the slower networked quality check run on demand / pre-deploy.
