import { requireSql } from '@/lib/db'
import { embedQuery } from './embed'

// Hybrid retrieval: dense (pgvector cosine) ⊕ sparse (Postgres FTS), fused by Reciprocal
// Rank Fusion, then aggregated chunk→lab by max-passage.
//
// Deliberately MINIMAL for a ~6.8k-chunk / 367-lab corpus — no reranker, no query rewrite,
// no score normalization. Two reasons this is right-sized, not lazy:
//   • RRF fuses on RANK, not score, so the dense arm (cosine ~0..1) and the sparse arm
//     (unbounded ts_rank) never need their incompatible scales reconciled — the failure mode
//     where the larger-magnitude arm silently drowns the other simply can't happen.
//   • At this size ANN recall is a non-problem (a few thousand rows scan in ms), so the only
//     pgvector knob that matters is ef_search ≥ the candidate LIMIT (below).
// The dense-only match gate DID miss on lexical queries (a "mismatch repair" lab ranked below
// generic "yeast" hits) — that concrete miss is why the sparse arm earns its place here.
// (Design rationale + why the heavier production machinery is intentionally omitted:
// the 2026-08-01 retrieval research pass.)

const RRF_K = 60 // SIGIR-2009 default; optimum is empirically flat over [20,100]
const CANDIDATES = 80 // per arm — ample distinct labs for a top-10 at 367 labs
const EF_SEARCH = 200 // HNSW query-time recall dial; MUST be ≥ CANDIDATES or the index
// silently returns fewer rows than asked (the classic pgvector gotcha).

export interface RetrievedChunk {
  chunkId: number
  labUrl: string
  piName: string | null
  department: string | null
  type: string
  title: string | null
  content: string
  anchorQuote: string | null
  sourceId: string | null
  denseRank: number | null
  sparseRank: number | null
  rrf: number
}

export interface RetrievedLab {
  labUrl: string
  piName: string | null
  department: string | null
  score: number // max-passage: the lab's single best chunk's RRF (volume-neutral)
  hitCount: number // how many chunks surfaced — context only, NOT part of the score
  topChunks: RetrievedChunk[]
}

export interface RetrieveOpts {
  candidates?: number
  k?: number
  wDense?: number
  wSparse?: number
}

export interface RetrieveLabsOpts extends RetrieveOpts {
  topLabs?: number
  chunksPerLab?: number
}

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const SELECT_COLS = `lc.id, lc.lab_url, p.pi_name, p.department, lc.type, lc.title, lc.content, lc.anchor_quote, lc.source_id`

function toChunk(r: Record<string, unknown>): RetrievedChunk {
  return {
    chunkId: Number(r.id),
    labUrl: String(r.lab_url),
    piName: (r.pi_name as string) ?? null,
    department: (r.department as string) ?? null,
    type: String(r.type),
    title: (r.title as string) ?? null,
    content: String(r.content),
    anchorQuote: (r.anchor_quote as string) ?? null,
    sourceId: (r.source_id as string) ?? null,
    denseRank: null,
    sparseRank: null,
    rrf: 0,
  }
}

// Fuse the dense + sparse candidate lists into one RRF-scored chunk list (best first).
export async function retrieveChunks(query: string, opts: RetrieveOpts = {}): Promise<RetrievedChunk[]> {
  const sql = requireSql()
  const cand = opts.candidates ?? CANDIDATES
  const k = opts.k ?? RRF_K
  const wDense = opts.wDense ?? 1
  const wSparse = opts.wSparse ?? 1

  const qvec = await embedQuery(query)
  const vec = `[${qvec.join(',')}]`

  // Dense arm. SET LOCAL + SELECT in ONE transaction so ef_search actually applies to the
  // query — a session-level SET wouldn't survive the pooled-HTTP hop to the next statement.
  // EF_SEARCH is a hardcoded int constant (no user input), so inlining it is safe.
  const denseTxn = await sql.transaction((txn) => [
    txn.query(`SET LOCAL hnsw.ef_search = ${EF_SEARCH}`),
    txn.query(
      `SELECT ${SELECT_COLS}
       FROM lab_chunks lc JOIN lab_profiles p ON p.lab_url = lc.lab_url
       WHERE lc.embedding IS NOT NULL
       ORDER BY lc.embedding <=> $1::vector
       LIMIT ${cand}`,
      [vec],
    ),
  ])
  const denseRows = asRows(denseTxn[1])

  // Sparse arm. websearch_to_tsquery / plainto_tsquery AND every term together — fatal for a
  // multi-concept interest query ("CRISPR ... DNA mismatch repair ... yeast" → 8 ANDed terms →
  // 0 chunks contain all of them → the sparse arm silently dies and hybrid collapses to
  // dense-only). Instead we OR the query's lexemes: normalize the free text to lexemes with
  // to_tsvector, join them with ' | ', and compile with to_tsquery. Any-term matches qualify,
  // and ts_rank_cd still ranks by how many (and how positionally-tight) the terms are — which
  // is exactly the lexical signal that lifts a rare-term lab (e.g. "mismatch repair") that
  // dense semantics smears away. Injection-safe: the raw text only ever reaches to_tsvector as
  // a bound parameter; the OR-tsquery is assembled entirely inside Postgres. All-stopword input
  // → empty tsquery → no rows, and RRF then simply uses the dense arm.
  const sparseRows = asRows(
    await sql.query(
      `WITH q AS (
         SELECT to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', $1)), ' | ')) AS tsq
       )
       SELECT ${SELECT_COLS}
       FROM lab_chunks lc JOIN lab_profiles p ON p.lab_url = lc.lab_url, q
       WHERE lc.content_tsv @@ q.tsq
       ORDER BY ts_rank_cd(lc.content_tsv, q.tsq) DESC
       LIMIT ${cand}`,
      [query],
    ),
  )

  const fused = new Map<number, RetrievedChunk>()
  const bump = (rows: Array<Record<string, unknown>>, arm: 'dense' | 'sparse', w: number): void => {
    rows.forEach((r, i) => {
      const rank = i + 1
      const id = Number(r.id)
      let c = fused.get(id)
      if (!c) {
        c = toChunk(r)
        fused.set(id, c)
      }
      if (arm === 'dense') c.denseRank = rank
      else c.sparseRank = rank
      c.rrf += w / (k + rank)
    })
  }
  bump(denseRows, 'dense', wDense)
  bump(sparseRows, 'sparse', wSparse)

  return [...fused.values()].sort((a, b) => b.rrf - a.rrf)
}

// Aggregate fused chunks up to LAB level by max-passage (a lab's score = its single best
// chunk). Max is deliberately volume-neutral: a 40-paper lab gets no free boost over an
// 8-paper lab, which sum/mean pooling would hand it. Upgrade to top-n-mean only if
// spot-checks show single-chunk flukes.
export async function retrieveLabs(query: string, opts: RetrieveLabsOpts = {}): Promise<RetrievedLab[]> {
  const topLabs = opts.topLabs ?? 10
  const chunksPerLab = opts.chunksPerLab ?? 3
  const chunks = await retrieveChunks(query, opts)

  const byLab = new Map<string, RetrievedChunk[]>()
  for (const c of chunks) {
    const arr = byLab.get(c.labUrl) ?? []
    arr.push(c)
    byLab.set(c.labUrl, arr)
  }

  const labs: RetrievedLab[] = [...byLab.entries()].map(([labUrl, cs]) => {
    cs.sort((a, b) => b.rrf - a.rrf)
    return {
      labUrl,
      piName: cs[0].piName,
      department: cs[0].department,
      score: cs[0].rrf, // max-passage
      hitCount: cs.length,
      topChunks: cs.slice(0, chunksPerLab),
    }
  })
  labs.sort((a, b) => b.score - a.score)
  return labs.slice(0, topLabs)
}
