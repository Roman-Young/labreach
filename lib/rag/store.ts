import { requireSql } from '@/lib/db'
import type { LabProfile } from '@/types'
import type { LabChunk } from './chunk'

type Row = Record<string, unknown>
const asRows = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []))

export interface SeedLab {
  labUrl: string
  piName: string | null
  department: string | null
  school: string | null
}

export interface QueueLab {
  labUrl: string
  piName: string | null
  department: string | null
  school: string | null
}

// Seed the work queue from the enumerator output. Idempotent: existing rows keep
// their status/profile; enumeration metadata (department/school) is authoritative.
export async function seedLabs(labs: SeedLab[]): Promise<number> {
  const sql = requireSql()
  let n = 0
  for (const lab of labs) {
    if (!lab.labUrl) continue
    await sql.query(
      `INSERT INTO lab_profiles (lab_url, pi_name, department, school, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (lab_url) DO UPDATE SET
         pi_name    = COALESCE(lab_profiles.pi_name, EXCLUDED.pi_name),
         department = COALESCE(EXCLUDED.department, lab_profiles.department),
         school     = COALESCE(EXCLUDED.school, lab_profiles.school)`,
      [lab.labUrl, lab.piName, lab.department, lab.school],
    )
    n++
  }
  return n
}

// Pull labs to work on (default: everything not yet done). ORDER stable for resumability.
export async function getLabs(
  opts: { status?: string[]; department?: string; limit?: number } = {},
): Promise<QueueLab[]> {
  const sql = requireSql()
  const params: unknown[] = [opts.status ?? ['pending', 'failed']]
  let q = `SELECT lab_url, pi_name, department, school FROM lab_profiles WHERE status = ANY($1::text[])`
  if (opts.department) {
    params.push(opts.department)
    q += ` AND department = $${params.length}`
  }
  q += ` ORDER BY department, lab_url`
  if (opts.limit) {
    params.push(opts.limit)
    q += ` LIMIT $${params.length}`
  }
  return asRows(await sql.query(q, params)).map((r) => ({
    labUrl: String(r.lab_url),
    piName: (r.pi_name as string) ?? null,
    department: (r.department as string) ?? null,
    school: (r.school as string) ?? null,
  }))
}

export async function markFailed(labUrl: string, error: string): Promise<void> {
  const sql = requireSql()
  await sql.query(
    `UPDATE lab_profiles SET status = 'failed', error = $2, attempts = attempts + 1, updated_at = now()
     WHERE lab_url = $1`,
    [labUrl, error.slice(0, 2000)],
  )
}

export async function statusCounts(): Promise<Array<{ department: string; status: string; count: number }>> {
  const sql = requireSql()
  return asRows(await sql.query(
    `SELECT COALESCE(department, '(none)') AS department, status, count(*)::int AS count
     FROM lab_profiles GROUP BY 1, 2 ORDER BY 1, 2`,
  )).map((r) => ({ department: String(r.department), status: String(r.status), count: Number(r.count) }))
}

// Store one lab: upsert the profile row (status='done') and REPLACE its chunk set.
// Enumeration's department/school (seeded) are preserved over the extraction's guess.
export async function storeLab(profile: LabProfile, chunks: LabChunk[]): Promise<void> {
  const sql = requireSql()
  const { rawPages, ...profileJson } = profile

  await sql.query(
    `INSERT INTO lab_profiles
       (lab_url, lab_name, pi_name, pi_email, school, department, data_modality, recruiting,
        research_areas, organisms, profile, raw_pages, research_quality, last_refreshed,
        status, error, harvested_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::text[],$11::jsonb,$12::jsonb,$13,$14,
             'done', NULL, now(), now())
     ON CONFLICT (lab_url) DO UPDATE SET
       lab_name = EXCLUDED.lab_name, pi_name = EXCLUDED.pi_name, pi_email = EXCLUDED.pi_email,
       school     = COALESCE(lab_profiles.school, EXCLUDED.school),
       department = COALESCE(lab_profiles.department, EXCLUDED.department),
       data_modality = EXCLUDED.data_modality, recruiting = EXCLUDED.recruiting,
       research_areas = EXCLUDED.research_areas, organisms = EXCLUDED.organisms,
       profile = EXCLUDED.profile, raw_pages = EXCLUDED.raw_pages,
       research_quality = EXCLUDED.research_quality, last_refreshed = EXCLUDED.last_refreshed,
       status = 'done', error = NULL, harvested_at = now(), updated_at = now()`,
    [
      profile.labUrl, profile.labName, profile.piName, profile.piEmail, profile.school,
      profile.department, profile.dataModality.value, profile.recruiting.status,
      profile.researchAreas, profile.organisms, JSON.stringify(profileJson),
      rawPages ? JSON.stringify(rawPages) : null, profile.researchQuality, profile.lastRefreshed,
    ],
  )

  // Replace this lab's chunks (clean re-extraction).
  await sql.query('DELETE FROM lab_chunks WHERE lab_url = $1', [profile.labUrl])
  for (const c of chunks) {
    await sql.query(
      'INSERT INTO lab_chunks (lab_url, type, content, source) VALUES ($1, $2, $3, $4)',
      [profile.labUrl, c.type, c.content, c.source],
    )
  }
}
