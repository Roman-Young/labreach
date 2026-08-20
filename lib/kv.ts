import { kv } from '@vercel/kv'
import fs from 'fs'
import path from 'path'

const LOCAL_STORE_PATH = path.join(process.cwd(), '.tmp', 'kv-store.json')

function isKvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

// FAIL LOUD if KV is missing in production. Without this, an unset/renamed KV var silently routes
// every read through the DEV FILE STORE below — and on a serverless read-only filesystem the writes
// throw (swallowed) and reads return {}, so kvGet returns null forever and BOTH checkRateLimit and
// checkDailyCap allow everything, unconditionally, with no error anywhere. That is a total loss of
// cost control that looks exactly like normal operation.
//
// This is a live hazard, not hypothetical: @vercel/kv is deprecated, and migrating to the Upstash
// marketplace integration renames these vars to UPSTASH_REDIS_REST_* — which would silently disable
// every limit. A loud boot failure is strictly better than an uncapped LLM bill.
function assertKvInProduction(): void {
  if (process.env.NODE_ENV === 'production' && !isKvConfigured()) {
    throw new Error(
      'KV is not configured in production (KV_REST_API_URL / KV_REST_API_TOKEN missing). ' +
        'Rate limiting and the daily spend cap would silently no-op — refusing to run without them.',
    )
  }
}

function localRead(): Record<string, string> {
  try {
    const dir = path.dirname(LOCAL_STORE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(LOCAL_STORE_PATH)) return {}
    return JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function localWrite(store: Record<string, string>): void {
  try {
    const dir = path.dirname(LOCAL_STORE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
  } catch {
    // ignore write errors in local dev
  }
}

export async function kvGet(key: string): Promise<string | null> {
  if (!isKvConfigured()) {
    const store = localRead()
    const expiry = store[`__ttl__${key}`]
    if (expiry && Date.now() > Number(expiry)) {
      delete store[key]
      delete store[`__ttl__${key}`]
      localWrite(store)
      return null
    }
    return store[key] ?? null
  }
  // MUST re-serialize. Upstash defaults `automaticDeserialization` to ON (see
  // @upstash/redis chunk-*.mjs: `deserialize = ... ?? parseResponse`) and @vercel/kv never disables
  // it — so kv.get JSON.parses the stored text and hands back an OBJECT/NUMBER, not the string we
  // wrote. `kv.get<string>` was a TYPE-LEVEL LIE with no runtime effect.
  //
  // The bug this caused (found in the 2026-08-20 pre-push audit): checkRateLimit stores
  // JSON.stringify(entry), so kvGet returned a parsed object, then rate-limit.ts did JSON.parse on
  // it -> JSON.parse("[object Object]") -> SyntaxError -> swallowed by its catch -> fell back to the
  // per-serverless-instance in-memory Map. Net effect: the KV rate limiter NEVER worked in
  // production and every cap silently reset on cold start. (checkDailyCap survived by luck: it
  // stores a bare integer, and Number(5) works on the number it got back.)
  const v = await kv.get(key)
  if (v === null || v === undefined) return null
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export async function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (!isKvConfigured()) {
    const store = localRead()
    store[key] = value
    if (ttlSeconds) {
      store[`__ttl__${key}`] = String(Date.now() + ttlSeconds * 1000)
    }
    localWrite(store)
    return
  }
  if (ttlSeconds) {
    await kv.set(key, value, { ex: ttlSeconds })
  } else {
    await kv.set(key, value)
  }
}

export async function kvDelete(key: string): Promise<void> {
  if (!isKvConfigured()) {
    const store = localRead()
    delete store[key]
    delete store[`__ttl__${key}`]
    localWrite(store)
    return
  }
  await kv.del(key)
}

export const KV_KEYS = {
  trainingLog: 'training:log',
  userRefinements: 'user:refinements',
  learningSynthesis: 'learning:synthesis',
  evaluatorLog: 'evaluator:log',
  calibrationLabels: 'calibration:labels',
  calibrationSynthesis: 'calibration:synthesis',
  // The active evaluator prompt saved from /admin/calibrate. Absent = use
  // DEFAULT_EVALUATOR_PROMPT (the code constant). Lets calibration changes gate
  // real emails without a redeploy; "Reset to default" deletes this key.
  evaluatorPrompt: 'evaluator:prompt',
} as const
