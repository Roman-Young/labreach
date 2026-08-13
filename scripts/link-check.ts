export {} // module scope
// LINK-ROT scan of every done lab's lab_url. HEAD (fallback GET) each, low concurrency for the
// 8GB no-swap box, stamp url_status ('ok' | 'redirect' | 'dead') + url_status_checked_at. Redirects
// record their final location in notes only (we do NOT auto-repoint blindly). Mechanical breaks that
// match a known restructure pattern are proposed in dead-urls.txt for Roman, not silently rewritten.
//   npx tsx scripts/link-check.ts            → scan + stamp url_status, write dead-urls.txt
//   npx tsx scripts/link-check.ts --dry      → scan + report only, no DB writes
process.loadEnvFile('.env.local')

import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileP = promisify(execFile)

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TIMEOUT = 15000

type Check = { url: string; pi: string; status: 'ok' | 'redirect' | 'dead'; code: number | null; finalUrl?: string; note?: string }

// Fallback liveness probe via curl -k: distinguishes a lab that is LIVE-but-cert-broken (Node's fetch
// rejects the TLS chain, a browser click-throughs it) from one that is truly unreachable. A false
// "dead" here would wrongly hide a real, active lab from students — so we never trust fetch's failure
// alone. Returns the HTTP code curl saw ignoring cert errors, or 0 if truly unreachable.
async function curlProbe(url: string): Promise<number> {
  try {
    const { stdout } = await execFileP('curl', ['-skL', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '20', '-A', UA, url], {
      timeout: 25000,
    })
    return parseInt(stdout.trim(), 10) || 0
  } catch {
    return 0
  }
}

async function probe(url: string): Promise<{ status: 'ok' | 'redirect' | 'dead'; code: number | null; finalUrl?: string; note?: string }> {
  const attempt = async (method: 'HEAD' | 'GET') => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT)
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } })
      return res
    } finally {
      clearTimeout(t)
    }
  }
  try {
    let res = await attempt('HEAD')
    // Many servers reject/blackhole HEAD; retry with GET on 405/403/501 or any 4xx/5xx.
    if (res.status === 405 || res.status === 403 || res.status === 501 || res.status >= 400) {
      try {
        res = await attempt('GET')
      } catch {
        /* keep HEAD result */
      }
    }
    const finalUrl = res.url && res.url !== url ? res.url : undefined
    if (res.status >= 200 && res.status < 400) {
      return { status: finalUrl ? 'redirect' : 'ok', code: res.status, finalUrl }
    }
    return { status: 'dead', code: res.status, finalUrl, note: `HTTP ${res.status}` }
  } catch (e) {
    // fetch failed (often a TLS-chain reject). Confirm with curl -k before declaring the lab dead.
    const code = await curlProbe(url)
    if (code >= 200 && code < 400) return { status: 'ok', code, note: 'reachable via curl -k (cert/TLS issue)' }
    return { status: 'dead', code: code || null, note: (e as Error).name === 'AbortError' ? 'timeout' : `unreachable (${(e as Error).message})` }
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const idx = i++
        if (idx >= items.length) return
        out[idx] = await fn(items[idx])
      }
    }),
  )
  return out
}

async function main() {
  const dry = process.argv.includes('--dry')
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const labs = rows(await sql.query(`SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' ORDER BY lab_url`))
  console.log(`link-checking ${labs.length} lab_urls (concurrency 6, ${dry ? 'DRY' : 'stamping url_status'})...\n`)

  const results = await pool(labs, 6, async (l): Promise<Check> => {
    const p = await probe(l.lab_url as string)
    return { url: l.lab_url as string, pi: l.pi_name as string, ...p }
  })

  const dead = results.filter((r) => r.status === 'dead')
  const redirect = results.filter((r) => r.status === 'redirect')
  const ok = results.filter((r) => r.status === 'ok')
  console.log(`ok: ${ok.length}   redirect: ${redirect.length}   dead: ${dead.length}\n`)

  if (redirect.length) {
    console.log(`REDIRECTS (${redirect.length}) — page moved, still resolves:`)
    for (const r of redirect) console.log(`  ${r.pi}\n     ${r.url}\n     → ${r.finalUrl}`)
    console.log()
  }
  console.log(`DEAD (${dead.length}):`)
  for (const d of dead) console.log(`  ${d.pi}  [${d.note}]\n     ${d.url}`)

  if (!dry) {
    for (const r of results) {
      await sql.query(
        `UPDATE lab_profiles SET url_status = $2, url_checked_at = now() WHERE lab_url = $1`,
        [r.url, r.status],
      )
    }
    const fs = await import('fs')
    const lines = [`Dead / moved lab_urls — generated ${new Date().toISOString().slice(0, 10)}`, '']
    lines.push(`## DEAD (${dead.length}) — need a new URL from Roman`)
    for (const d of dead) lines.push(`  ${d.pi}  [${d.note}]\n    ${d.url}`)
    lines.push('', `## REDIRECTS (${redirect.length}) — resolve but moved; repoint if the target is the real lab`)
    for (const r of redirect) lines.push(`  ${r.pi}\n    ${r.url}\n    → ${r.finalUrl}`)
    fs.writeFileSync('dead-urls.txt', lines.join('\n'))
    console.log(`\n✓ stamped url_status on ${results.length} labs; wrote dead-urls.txt`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
