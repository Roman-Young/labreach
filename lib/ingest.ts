import { storeLabV2 } from '@/lib/rag/store'
import { gatherLab } from '@/lib/rag/gather'
import { extractLabV2 } from '@/lib/rag/extract2'
import type { LabProfile } from '@/types'

// v2 ingestion — the ONLY ingestion path. Deterministic gather -> single static
// extraction -> rich per-paper chunks. Cheaper (~1 Gemini call + ~2 Firecrawl
// credits/lab) and higher quality than the retired v1 agentic path (lib/agent,
// archived to _legacy/ on 2026-08-21 — it had no production caller).
export async function ingestLabV2(
  labUrl: string,
  onProgress: (m: string) => void = () => {},
  piName?: string | null,
  opts: { pubPageUrl?: string; sinceYear?: number; orcid?: string; nameUnfiltered?: boolean; institute?: string } = {},
): Promise<{ profile: LabProfile; chunkCount: number; paperCount: number }> {
  const g = await gatherLab(labUrl, piName ?? null, onProgress, opts)
  const { profile, chunks } = await extractLabV2(g)
  await storeLabV2(profile, chunks)
  // paperCount lets the batch tell "genuinely nothing to find" (0 papers -> no_sources,
  // terminal) from "papers existed but 0 chunks survived" (retryable failed, not buried).
  return { profile, chunkCount: chunks.length, paperCount: g.papers.length }
}
