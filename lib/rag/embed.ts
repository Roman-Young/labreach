import { requireSql } from '@/lib/db'
import { withRetry } from '@/lib/retry'

// Dense embeddings for lab_chunks — the "dense half" of hybrid retrieval (the sparse half,
// content_tsv, already exists). Model: gemini-embedding-001 (the only embedding model this
// key exposes; text-embedding-004 404s). It's a Matryoshka model (native 3072-dim), which we
// TRUNCATE to 768 and L2-NORMALISE — 768 keeps the pgvector column lean and, per Google's
// guidance, a truncated MRL vector must be re-normalised for cosine to behave.
//
// UNTESTED UNTIL CREDIT: written while the Gemini prepay balance was depleted. The FIRST thing
// to run after top-up is `ingest.ts embed --limit 20` and eyeball the [embed] cost line before
// backfilling all ~6.5k chunks.

const EMBED_MODEL = 'gemini-embedding-001'
export const EMBED_DIM = 768
const BATCH = 100
const MAX_CHARS = 8000 // ~2k tokens — gemini-embedding-001's input ceiling; chunks are far smaller

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

function l2norm(v: number[]): number[] {
  let s = 0
  for (const x of v) s += x * x
  const n = Math.sqrt(s) || 1
  return v.map((x) => x / n)
}

// Embed a batch of texts. taskType RETRIEVAL_DOCUMENT (asymmetric: queries embed as
// RETRIEVAL_QUERY at search time — see retrieve.ts). Cost is per input token regardless of
// batching, so we log an estimate rather than trust a batch usageMetadata that may be absent.
async function embedBatch(texts: string[]): Promise<number[][]> {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) throw new Error('GOOGLE_AI_API_KEY is not set')
  const requests = texts.map((t) => ({
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text: t.slice(0, MAX_CHARS) }] },
    outputDimensionality: EMBED_DIM,
    taskType: 'RETRIEVAL_DOCUMENT',
  }))
  const data = await withRetry(async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(60000),
      },
    )
    if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 160)}`)
    return (await res.json()) as { embeddings?: Array<{ values: number[] }> }
  }, { attempts: 4, delayMs: 2000 })
  const embs = data.embeddings ?? []
  if (embs.length !== texts.length) throw new Error(`embed count mismatch: ${embs.length} vs ${texts.length}`)
  return embs.map((e) => l2norm(e.values))
}

export async function ensureEmbeddingSchema(): Promise<void> {
  const sql = requireSql()
  await sql.query(`ALTER TABLE lab_chunks ADD COLUMN IF NOT EXISTS embedding vector(${EMBED_DIM})`)
}

// Backfill embeddings for every chunk that lacks one. Resumable: re-running only touches
// chunks with NULL embedding, so a crash/credit-out loses nothing.
export async function backfillEmbeddings(
  onProgress: (m: string) => void = (m) => console.log(m),
  limit?: number,
): Promise<{ embedded: number; estTokens: number }> {
  const sql = requireSql()
  await ensureEmbeddingSchema()
  let embedded = 0
  let estTokens = 0
  for (;;) {
    if (limit && embedded >= limit) break
    const take = limit ? Math.min(BATCH, limit - embedded) : BATCH
    const rows = asRows(
      await sql.query(
        `SELECT id, content FROM lab_chunks
         WHERE embedding IS NULL AND content IS NOT NULL AND length(content) > 0
         ORDER BY id LIMIT ${take}`,
      ),
    )
    if (rows.length === 0) break
    const texts = rows.map((r) => String(r.content))
    const vecs = await embedBatch(texts)
    for (let i = 0; i < rows.length; i++) {
      await sql.query(`UPDATE lab_chunks SET embedding = $1::vector WHERE id = $2`, [`[${vecs[i].join(',')}]`, rows[i].id])
      estTokens += Math.ceil(texts[i].length / 4)
    }
    embedded += rows.length
    // ~$0.15 / 1M input tokens for gemini-embedding-001
    onProgress(`[embed] embedded ${embedded} chunks, ~${estTokens} tokens, ~$${((estTokens / 1e6) * 0.15).toFixed(4)}`)
  }
  return { embedded, estTokens }
}

// HNSW cosine index for fast ANN — built AFTER the backfill (cheaper to build once populated).
export async function createEmbeddingIndex(): Promise<void> {
  const sql = requireSql()
  await sql.query(
    `CREATE INDEX IF NOT EXISTS lab_chunks_embedding_idx ON lab_chunks USING hnsw (embedding vector_cosine_ops)`,
  )
}

// Embed a single query string (RETRIEVAL_QUERY) for search time — see retrieve.ts.
export async function embedQuery(text: string): Promise<number[]> {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) throw new Error('GOOGLE_AI_API_KEY is not set')
  const data = await withRetry(async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: text.slice(0, MAX_CHARS) }] },
          outputDimensionality: EMBED_DIM,
          taskType: 'RETRIEVAL_QUERY',
        }),
        signal: AbortSignal.timeout(30000),
      },
    )
    if (!res.ok) throw new Error(`embedQuery ${res.status}: ${(await res.text()).slice(0, 160)}`)
    return (await res.json()) as { embedding?: { values: number[] } }
  }, { attempts: 4, delayMs: 2000 })
  if (!data.embedding?.values) throw new Error('embedQuery: no embedding returned')
  return l2norm(data.embedding.values)
}
