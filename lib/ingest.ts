import { researchLab } from '@/lib/agent'
import { buildIngestionPrompt } from '@/lib/agent/prompts'
import { requireSql } from '@/lib/db'
import type { AgentResult, LabProfile } from '@/types'

// Map a student-agnostic research result (from researchLab) into a LabProfile.
// Pure: findings/open-problems come from the shared evidence; the rest from the
// ingestion-only labExtraction. Missing fields become null/[] — the ranker and
// digest handle absence gracefully.
export function mapToLabProfile(ar: AgentResult, labUrl: string): LabProfile {
  const lx = ar.labExtraction
  const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)
  return {
    labUrl,
    labName: clean(ar.labName),
    piName: clean(ar.piName),
    piTitle: null, // not currently extracted; add to the finish schema later if needed
    piEmail: clean(ar.piEmail),
    school: lx?.school ?? null,
    department: lx?.department ?? null,
    researchAreas: lx?.researchAreas ?? [],
    researchSummary: lx?.researchSummary ?? null,
    findings: ar.evidence.candidateFindings,
    openProblems: ar.evidence.openProblems,
    techniques: lx?.techniques ?? [],
    organisms: lx?.organisms ?? [],
    dataModality: lx?.dataModality ?? { value: null, evidence: null },
    teamComposition: lx?.teamComposition ?? [],
    recruiting: lx?.recruiting ?? { status: 'unknown', evidence: null },
    publications: ar.publicationsUsed,
    rawPages: null, // TODO: capture harvested page markdown for the re-scrape-free cache
    researchQuality: ar.researchQuality ?? null,
    lastRefreshed: new Date().toISOString(),
  }
}

// Upsert a LabProfile into lab_profiles, keyed on lab_url. The full profile is
// stored as JSONB (minus rawPages, which lives in its own column); the filter
// columns (division, modality, recruiting, arrays) are denormalized alongside.
export async function storeLabProfile(profile: LabProfile): Promise<void> {
  const sql = requireSql()
  const { rawPages, ...profileJson } = profile
  await sql.query(
    `INSERT INTO lab_profiles
       (lab_url, lab_name, pi_name, pi_email, school, department, data_modality,
        recruiting, research_areas, organisms, profile, raw_pages, research_quality,
        last_refreshed, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::text[],$11::jsonb,$12::jsonb,$13,$14, now())
     ON CONFLICT (lab_url) DO UPDATE SET
       lab_name = EXCLUDED.lab_name, pi_name = EXCLUDED.pi_name, pi_email = EXCLUDED.pi_email,
       school = EXCLUDED.school, department = EXCLUDED.department,
       data_modality = EXCLUDED.data_modality, recruiting = EXCLUDED.recruiting,
       research_areas = EXCLUDED.research_areas, organisms = EXCLUDED.organisms,
       profile = EXCLUDED.profile, raw_pages = EXCLUDED.raw_pages,
       research_quality = EXCLUDED.research_quality, last_refreshed = EXCLUDED.last_refreshed,
       updated_at = now()`,
    [
      profile.labUrl,
      profile.labName,
      profile.piName,
      profile.piEmail,
      profile.school,
      profile.department,
      profile.dataModality.value,
      profile.recruiting.status,
      profile.researchAreas,
      profile.organisms,
      JSON.stringify(profileJson),
      rawPages ? JSON.stringify(rawPages) : null,
      profile.researchQuality,
      profile.lastRefreshed,
    ],
  )
}

// Research + map + store one lab. This is the unit the batch runner / multi-agent
// fan-out parallelizes. Student-agnostic (ingestion prompt).
export async function ingestLab(
  labUrl: string,
  onProgress: (m: string) => void = () => {},
): Promise<LabProfile> {
  let ar = await researchLab(labUrl, buildIngestionPrompt(), onProgress)
  // Findings are the core of a profile; if the first pass came back empty (LLM
  // variance / a forced finish), give it one more attempt before storing.
  if (ar.evidence.candidateFindings.length === 0) {
    onProgress('No findings on the first pass — retrying research once...')
    ar = await researchLab(labUrl, buildIngestionPrompt(), onProgress)
  }
  const profile = mapToLabProfile(ar, labUrl)
  await storeLabProfile(profile)
  return profile
}
