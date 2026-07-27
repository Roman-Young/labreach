// LabReach DB migration — idempotent. Creates the lab_profiles table + pgvector.
// Run:  node --env-file=.env.local scripts/migrate.mjs
// Uses the direct (unpooled) connection for DDL; falls back to the pooled URL.

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('No DATABASE_URL(_UNPOOLED) in env — run with: node --env-file=.env.local scripts/migrate.mjs')
  process.exit(1)
}
const sql = neon(url)
const rows = (r) => (Array.isArray(r) ? r : r.rows ?? [])

const statements = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS lab_profiles (
    id               serial PRIMARY KEY,
    lab_url          text UNIQUE NOT NULL,
    lab_name         text,
    pi_name          text,
    pi_email         text,
    school           text,
    department       text,
    data_modality    text,                          -- 'wet' | 'dry' | 'mixed'
    recruiting       text,                          -- 'explicit_no' | 'open' | 'unknown'
    research_areas   text[] NOT NULL DEFAULT '{}',
    organisms        text[] NOT NULL DEFAULT '{}',
    profile          jsonb  NOT NULL,               -- the full quote-backed LabProfile
    raw_pages        jsonb,                          -- harvested markdown by page type (the cache)
    research_quality text,
    last_refreshed   timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lab_profiles_school       ON lab_profiles(school)`,
  `CREATE INDEX IF NOT EXISTS idx_lab_profiles_department   ON lab_profiles(department)`,
  `CREATE INDEX IF NOT EXISTS idx_lab_profiles_modality     ON lab_profiles(data_modality)`,
  `CREATE INDEX IF NOT EXISTS idx_lab_profiles_recruiting   ON lab_profiles(recruiting)`,
  `CREATE INDEX IF NOT EXISTS idx_lab_profiles_areas        ON lab_profiles USING gin(research_areas)`,
  `CREATE INDEX IF NOT EXISTS idx_lab_profiles_organisms    ON lab_profiles USING gin(organisms)`,
]

for (const stmt of statements) {
  await sql.query(stmt)
  console.log('ok:', stmt.trim().split('\n')[0].slice(0, 60))
}

const count = rows(await sql.query('SELECT count(*)::int AS count FROM lab_profiles'))[0]?.count
const ext = rows(await sql.query("SELECT extname FROM pg_extension WHERE extname = 'vector'"))
console.log(`\nlab_profiles rows: ${count} | pgvector: ${ext.length ? 'enabled' : 'MISSING'}`)
console.log('migration complete ✓')
