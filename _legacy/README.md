# `_legacy/` — archived v1 ingestion (frozen 2026-08-21)

This is the **retired v1 "agentic" ingestion pipeline**. It had **zero production callers** when
archived — nothing in `app/` (serving) or the live v2 ingestion path imported it. It was only ever
reached by two standalone verification scripts (also archived here) and the retired `reextract`
command. Kept for reference, not built: `_legacy` is in `tsconfig.json`'s `exclude`, so nothing here
is compiled or reachable from the app.

## What's here and what replaced it

| archived | was | replaced by (live) |
|---|---|---|
| `lib/agent/` | LLM ran a tool-loop to research a lab (`researchLab`) + the email `writer`/`evaluator` | `lib/rag/gather.ts` + `lib/rag/extract2.ts` (deterministic gather → single static extraction) |
| `lib/rag/extract.ts` | v1 static extractor (`extractFromPages`) | `lib/rag/extract2.ts` (`extractLabV2`) |
| `lib/rag/chunk.ts` | v1 `LabChunk` model + `mapToLabProfile`/`toChunks` | rich per-paper chunks in `extract2.ts` (`LabChunkV2`) + `storeLabV2` |
| `scripts/verify-ingest.ts`, `scripts/verify-research.ts` | exercised v1 end-to-end | — (v2 is covered by the eval + db-invariant tests) |

## Why it was removed

Three ingestion generations coexisted (v1 agentic, v2 deterministic, wave-2 pub-page). v1 was dead
weight that made "which code is live" ambiguous and kept the worse chunk model one command away
(`ingest.ts reextract`, now retired). Removing it makes a future extraction-quality change unambiguous.

## Note

The absolute (`@/…`) imports inside these files point at live paths that have moved or changed, so this
code will **not** compile as-is if un-excluded — it's a frozen snapshot. The faithful history is in git
(`git log --follow` on any file here); recover a working copy from the commit before archival if ever
needed.
