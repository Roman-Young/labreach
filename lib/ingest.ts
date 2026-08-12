import { researchLab } from '@/lib/agent'
import { buildIngestionPrompt } from '@/lib/agent/prompts'
import { mapToLabProfile, toChunks } from '@/lib/rag/chunk'
import { storeLab, storeLabV2 } from '@/lib/rag/store'
import { gatherLab } from '@/lib/rag/gather'
import { extractLabV2 } from '@/lib/rag/extract2'
import type { LabProfile } from '@/types'

// v2 ingestion (default): deterministic gather -> single static extraction ->
// rich per-paper chunks. Cheaper (~1 Gemini call + ~2 Firecrawl credits/lab) and
// higher quality than the v1 agentic path (see scripts/audit.ts head-to-head).
export async function ingestLabV2(
  labUrl: string,
  onProgress: (m: string) => void = () => {},
  piName?: string | null,
  opts: { pubPageUrl?: string; sinceYear?: number; orcid?: string; nameUnfiltered?: boolean } = {},
): Promise<{ profile: LabProfile; chunkCount: number; paperCount: number }> {
  const g = await gatherLab(labUrl, piName ?? null, onProgress, opts)
  const { profile, chunks } = await extractLabV2(g)
  await storeLabV2(profile, chunks)
  // paperCount lets the batch tell "genuinely nothing to find" (0 papers -> no_sources,
  // terminal) from "papers existed but 0 chunks survived" (retryable failed, not buried).
  return { profile, chunkCount: chunks.length, paperCount: g.papers.length }
}

// Research + map + store one lab — the unit the batch runner parallelizes.
// Student-agnostic (ingestion prompt): exhaustive chunks + the whole-lab profile,
// with raw pages cached for free re-extraction.
export async function ingestLab(
  labUrl: string,
  onProgress: (m: string) => void = () => {},
  piName?: string | null,
): Promise<{ profile: LabProfile; chunkCount: number }> {
  let ar = await researchLab(labUrl, buildIngestionPrompt(), onProgress, piName)
  // Findings are the core; if the first pass came back empty (LLM variance / a
  // forced finish), retry once before storing.
  if (ar.evidence.candidateFindings.length === 0) {
    onProgress('No findings on the first pass — retrying research once...')
    ar = await researchLab(labUrl, buildIngestionPrompt(), onProgress, piName)
  }
  const profile = mapToLabProfile(ar, labUrl)
  const chunks = toChunks(ar)
  await storeLab(profile, chunks)
  return { profile, chunkCount: chunks.length }
}
