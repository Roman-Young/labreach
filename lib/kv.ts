import { kv } from '@vercel/kv'
import fs from 'fs'
import path from 'path'

const LOCAL_STORE_PATH = path.join(process.cwd(), '.tmp', 'kv-store.json')

function isKvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
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
  return (await kv.get<string>(key)) ?? null
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

export const KV_KEYS = {
  trainingLog: 'training:log',
  userRefinements: 'user:refinements',
  learningSynthesis: 'learning:synthesis',
  evaluatorLog: 'evaluator:log',
  calibrationLabels: 'calibration:labels',
  calibrationSynthesis: 'calibration:synthesis',
} as const
