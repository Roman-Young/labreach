import { neon } from '@neondatabase/serverless'

// Neon serverless Postgres client. One HTTP round-trip per query — serverless-
// friendly for the app, and fine for the ingestion batch's sequential upserts.
// Uses the POOLED url (DATABASE_URL); the ingestion script may prefer the direct
// DATABASE_URL_UNPOOLED for long runs. Null when unconfigured so importing this
// at build time (no env) doesn't throw — mirrors lib/kv.ts's graceful pattern.

const connectionString = process.env.DATABASE_URL

export const dbConfigured = !!connectionString

export const sql = connectionString ? neon(connectionString) : null

export function requireSql() {
  if (!sql) {
    throw new Error(
      'DATABASE_URL is not set — cannot reach Postgres. Add it to .env.local (see .env.example).',
    )
  }
  return sql
}
