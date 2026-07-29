import { researchLab } from '@/lib/agent'
import { buildIngestionPrompt } from '@/lib/agent/prompts'
import { mapToLabProfile, toChunks } from '@/lib/rag/chunk'
import { storeLab } from '@/lib/rag/store'
import type { LabProfile } from '@/types'

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
