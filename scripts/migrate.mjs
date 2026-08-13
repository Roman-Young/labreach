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

  // ── Pipeline / queue state on lab_profiles (idempotent) ──
  // profile is nullable so a row can be seeded (pending) before it's extracted.
  `ALTER TABLE lab_profiles
     ALTER COLUMN profile DROP NOT NULL,
     ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'pending',  -- pending | done | failed
     ADD COLUMN IF NOT EXISTS error        text,
     ADD COLUMN IF NOT EXISTS attempts     int  NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS harvested_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS idx_lab_profiles_status ON lab_profiles(status)`,

  // ── lab_chunks: the exhaustive, RAG-grade knowledge base (one row per connection unit) ──
  // content_tsv (FTS) is the SPARSE half of hybrid search, built now — free, no model.
  // An `embedding vector` column (the DENSE half) is added in the mandated follow-on.
  `CREATE TABLE IF NOT EXISTS lab_chunks (
    id          serial PRIMARY KEY,
    lab_url     text NOT NULL REFERENCES lab_profiles(lab_url) ON DELETE CASCADE,
    type        text NOT NULL,           -- finding | technique | project | future_direction | other
    content     text NOT NULL,           -- the quote/claim (the embeddable, searchable unit)
    source      text,                    -- paper title+year / page it came from
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    created_at  timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lab_chunks_lab_url ON lab_chunks(lab_url)`,
  `CREATE INDEX IF NOT EXISTS idx_lab_chunks_type    ON lab_chunks(type)`,
  `CREATE INDEX IF NOT EXISTS idx_lab_chunks_tsv     ON lab_chunks USING gin(content_tsv)`,

  // ── v2: rich per-paper chunk fields (idempotent). `type` now holds the KIND
  // ('paper' | 'overview' | 'future_direction'); `content` is the woven summary;
  // `source`/`source_label` stays; source_id is the traceable DOI/PMID. ──
  `ALTER TABLE lab_chunks
     ADD COLUMN IF NOT EXISTS title        text,
     ADD COLUMN IF NOT EXISTS year         int,
     ADD COLUMN IF NOT EXISTS anchor_quote text,
     ADD COLUMN IF NOT EXISTS source_id    text,
     ADD COLUMN IF NOT EXISTS meta         jsonb`,

  // ── v3: attribution quarantine (2026-08-11). Reversibly hides a chunk from retrieval + the
  // lab page without deleting it — for papers proven to belong to a DIFFERENT same-surname person
  // (scripts/verify-attribution.ts → scripts/quarantine-attribution.ts). `quarantine_reason` keeps
  // the machine verdict for auditing/reversal. Mirrors the lab_profiles.status lifecycle pattern. ──
  `ALTER TABLE lab_chunks
     ADD COLUMN IF NOT EXISTS quarantined       boolean NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS quarantine_reason text`,
  `CREATE INDEX IF NOT EXISTS idx_lab_chunks_quarantined ON lab_chunks(quarantined)`,

  // ── v4: production hardening (2026-08-13) ──
  // Provenance + health columns so a NULL/"unknown" is auditable ("we looked on date X"), not a
  // shrug — and so a verified email/URL is never silently clobbered by a re-scrape.
  `ALTER TABLE lab_profiles
     ADD COLUMN IF NOT EXISTS pi_email_source        text,          -- 'scrape' | 'contact-hunt' | 'directory' | 'manual'
     ADD COLUMN IF NOT EXISTS pi_email_verified_at   timestamptz,
     ADD COLUMN IF NOT EXISTS recruiting_evidence    text,          -- verbatim quote backing the recruiting verdict
     ADD COLUMN IF NOT EXISTS recruiting_checked_at  timestamptz,   -- when the join-signal was last looked for
     ADD COLUMN IF NOT EXISTS url_status             text,          -- 'ok' | 'dead' | 'redirect'
     ADD COLUMN IF NOT EXISTS url_checked_at         timestamptz`,

  // Quarantine LEDGER — the durable record of which (lab_url, source_id) papers are known
  // contaminants and WHY. storeLabV2 re-applies these after a re-ingest's DELETE+re-INSERT, so a
  // re-ingest can never resurrect a paper we already proved wrong (esp. the domain-caught outliers
  // the attribution gate cannot re-derive). Reversible: delete the ledger row to un-quarantine.
  `CREATE TABLE IF NOT EXISTS quarantine_ledger (
     lab_url    text NOT NULL,
     source_id  text NOT NULL,
     reason     text,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (lab_url, source_id)
  )`,
]

for (const stmt of statements) {
  await sql.query(stmt)
  console.log('ok:', stmt.trim().split('\n')[0].slice(0, 60))
}

const profileCount = rows(await sql.query('SELECT count(*)::int AS c FROM lab_profiles'))[0]?.c
const chunkCount = rows(await sql.query('SELECT count(*)::int AS c FROM lab_chunks'))[0]?.c
const ext = rows(await sql.query("SELECT extname FROM pg_extension WHERE extname = 'vector'"))
const hasStatus = rows(await sql.query(
  "SELECT 1 FROM information_schema.columns WHERE table_name='lab_profiles' AND column_name='status'",
)).length
const profileNullable = rows(await sql.query(
  "SELECT is_nullable FROM information_schema.columns WHERE table_name='lab_profiles' AND column_name='profile'",
))[0]?.is_nullable
console.log(`\nlab_profiles: ${profileCount} rows (status col: ${hasStatus ? 'yes' : 'NO'}, profile nullable: ${profileNullable})`)
console.log(`lab_chunks:   ${chunkCount} rows | pgvector: ${ext.length ? 'enabled' : 'MISSING'}`)
console.log('migration complete ✓')
