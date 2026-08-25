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

  // ── v5 (2026-08-14): manual-data write guard. An automated apply_info re-sweep NULLed 4
  // hand-verified entries because its cache lacked the evidence — absence of evidence in a cache
  // is not evidence of absence. Every automated pass must SKIP source='manual' rows.
  `ALTER TABLE lab_profiles
     ADD COLUMN IF NOT EXISTS apply_info_source      text           -- 'extract' | 'manual'
  `,

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

  // ── v6 (2026-08-21): consolidate columns that batch scripts were creating as a SIDE EFFECT ──
  // These four columns are read by the PRODUCTION serving path (lib/rag/digest.ts renders
  // plain_summary/apply_info/trajectory; retrieval reads embedding), but were only ever created by
  // ad-hoc `ALTER ... ADD COLUMN IF NOT EXISTS` buried inside scripts/enrich.ts, enrich-trajectory.ts,
  // and lib/rag/embed.ts. A fresh checkout that ran ONLY this migration got a DB the app couldn't
  // serve from. Declaring them here makes migrate.mjs the single schema source of truth; the inline
  // ALTERs in those scripts stay (idempotent, harmless) as belt-and-suspenders. (Pre-push audit.)
  `ALTER TABLE lab_profiles
     ADD COLUMN IF NOT EXISTS plain_summary text,   -- first-year "what/how/why" (enrich pass)
     ADD COLUMN IF NOT EXISTS apply_info    jsonb,  -- lab's own quote-backed "how to join"
     ADD COLUMN IF NOT EXISTS trajectory    text    -- synthesized "where it's heading" (enrich)
  `,
  // embedding is vector(768) to match EMBED_DIM in lib/rag/embed.ts. embedding_model tags each row
  // with the model that produced it so a model migration can detect stale vectors (assertEmbeddingConsistency).
  `ALTER TABLE lab_chunks
     ADD COLUMN IF NOT EXISTS embedding       vector(768),
     ADD COLUMN IF NOT EXISTS embedding_model text`,
  `CREATE INDEX IF NOT EXISTS lab_chunks_embedding_idx ON lab_chunks USING hnsw (embedding vector_cosine_ops)`,

  // ── v7 (2026-08-25): optional Google sign-in + saved history (guest-by-default) ──
  // Sessions are JWTs (no adapter tables — next-auth manages nothing here); `users` exists purely
  // to key app data. ON DELETE CASCADE everywhere is the delete-my-data path: one DELETE FROM users
  // wipes flow state, history, and the telemetry mapping.
  `CREATE TABLE IF NOT EXISTS users (
     id            serial PRIMARY KEY,
     google_sub    text UNIQUE NOT NULL,      -- Google's stable account id (OIDC sub claim)
     email         text,
     name          text,
     avatar_url    text,
     created_at    timestamptz NOT NULL DEFAULT now(),
     last_login_at timestamptz
  )`,
  // Cross-device continuation: the signed-in mirror of the client's localStorage FlowState blob.
  `CREATE TABLE IF NOT EXISTS user_flow_state (
     user_id    int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     state      jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  // Search history: one row per completed search (pruned to the newest 50 per user on insert).
  `CREATE TABLE IF NOT EXISTS saved_searches (
     id         serial PRIMARY KEY,
     user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     profile    jsonb,
     query      text,
     labs       jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS idx_saved_searches_user_created ON saved_searches(user_id, created_at DESC)`,
  // Telemetry linkage — maps a user to their ANONYMOUS usage_events session ids. usage_events
  // itself stays PII-free and untouched; analysis JOINs through this table. Deleting the account
  // cascades ONLY the mapping, so events revert to anonymous aggregate data (identity severing).
  `CREATE TABLE IF NOT EXISTS user_sessions (
     user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     session_id text NOT NULL,
     linked_at  timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, session_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_sessions_session ON user_sessions(session_id)`,
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
// Verify the v6 serving-path columns actually exist — the whole point of declaring them here is that
// a fresh checkout is no longer missing what the app renders from. Print which are present.
const servingCols = rows(await sql.query(
  `SELECT column_name FROM information_schema.columns
   WHERE (table_name='lab_profiles' AND column_name IN ('plain_summary','apply_info','trajectory'))
      OR (table_name='lab_chunks'   AND column_name IN ('embedding','embedding_model'))`,
)).map((r) => r.column_name)
const wantCols = ['plain_summary', 'apply_info', 'trajectory', 'embedding', 'embedding_model']
const missingCols = wantCols.filter((c) => !servingCols.includes(c))
// v7 account tables — prove they exist (counts are expected to be 0 until sign-in is enabled).
const authTables = {}
for (const t of ['users', 'user_flow_state', 'saved_searches', 'user_sessions']) {
  authTables[t] = rows(await sql.query(`SELECT count(*)::int AS c FROM ${t}`))[0]?.c
}
console.log(`\nlab_profiles: ${profileCount} rows (status col: ${hasStatus ? 'yes' : 'NO'}, profile nullable: ${profileNullable})`)
console.log(`lab_chunks:   ${chunkCount} rows | pgvector: ${ext.length ? 'enabled' : 'MISSING'}`)
console.log(`serving cols: ${missingCols.length ? `MISSING ${missingCols.join(', ')}` : 'all present ✓'}`)
console.log(`account tables: ${Object.entries(authTables).map(([t, c]) => `${t}=${c}`).join(' · ')}`)
console.log('migration complete ✓')
