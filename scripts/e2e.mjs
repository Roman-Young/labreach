// End-to-end regression test for the digest flow, driven against a PRODUCTION build.
// Self-contained: spawns `next start`, drives a headless system Chrome through the real flow
// (intake → labs → star → compose), asserts behavior (not just "it rendered"), and exits 1 on
// any failure. Requires a build to exist (`npm run build` first) and a reachable DATABASE_URL.
//
//   npm run build && npm run test:e2e
//
// Env: E2E_PORT (default 3943), CHROME (default /usr/bin/google-chrome-stable).
// Born 2026-08-07: the first proper run of this caught a hydration race the happy-path smoke
// test missed (refresh bounced off /digest/lab and lost starred state) — assert, don't eyeball.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const PORT = process.env.E2E_PORT ?? '3943'
const B = `http://localhost:${PORT}`
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗ FAIL:', m) } }

// ── spawn the prod server ────────────────────────────────────────────────────
const server = spawn('npx', ['next', 'start', '-p', PORT], { stdio: 'ignore', detached: true })
const up = async () => { try { return (await fetch(B + '/digest')).ok } catch { return false } }
for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000))
if (!(await up())) { console.error('server never came up'); process.kill(-server.pid); process.exit(2) }

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1040, height: 1600 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B })
const page = await ctx.newPage()
const errs = []
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
const path = () => new URL(page.url()).pathname

try {
  // ── SECURITY (regression) — assert the launch-hardening holds so it can't silently revert ──
  console.log('\n— SECURITY —')
  const postJson = (p, obj) =>
    fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })

  const hdr = await fetch(B + '/digest')
  ok(hdr.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options: DENY present')
  ok(hdr.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff present')
  ok(!!hdr.headers.get('strict-transport-security'), 'HSTS header present')
  ok(!!hdr.headers.get('referrer-policy'), 'Referrer-Policy header present')

  // input caps on the one live LLM-cost route: oversized array is bounded (not crashed/unbounded),
  // and an over-long profile is rejected BEFORE any model call.
  const oversized = await postJson('/api/digest', { interests: Array(500).fill('immunology') })
  ok(oversized.status === 200, `oversized interests array handled, not crashed (got ${oversized.status})`)
  const longProfile = await postJson('/api/digest', { profile: 'a'.repeat(13000) })
  ok(longProfile.status === 400, `over-long profile rejected pre-LLM (got ${longProfile.status})`)

  // the retired writer/calibration routes must stay gone — attack surface stays reduced.
  for (const dead of ['/api/refine', '/api/research', '/api/re-evaluate', '/api/admin/sessions']) {
    const r = await postJson(dead, {})
    ok(r.status === 404, `${dead} is retired (got ${r.status})`)
  }

  console.log('\n— EDGE CASES —')
  await page.goto(B + '/digest/compose', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  ok(path() !== '/digest/compose', `direct /digest/compose with no state redirects away (got ${path()})`)

  await page.goto(B + '/digest', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /find my labs/i }).click()
  await page.waitForTimeout(500)
  ok((await page.locator('text=/Pick a few interests/i').count()) > 0, 'empty intake shows a validation error')

  console.log('\n— HAPPY PATH —')
  await page.fill('input[placeholder="Your name"]', 'Test Student')
  await page.selectOption('select', 'Sophomore')
  await page.fill('input[placeholder="Major"]', 'Bioinformatics')
  await page.getByRole('button', { name: 'Immunology & immunotherapy' }).click()
  await page.fill('textarea', 'IgA-coated maternal microbiota, single-cell RNA-seq with Seurat, flow cytometry.')
  await page.getByRole('button', { name: /find my labs/i }).click()
  await page.waitForURL('**/digest/labs', { timeout: 60000 })
  const labCount = await page.locator('[data-lab-card]').count()
  ok(labCount >= 5, `labs page shows ${labCount} labs`)

  await page.locator('[data-lab-card]').first().click()
  await page.waitForURL('**/digest/lab', { timeout: 20000 })
  await page.waitForSelector('text=Star the research', { timeout: 45000 })
  await page.waitForTimeout(1500)
  await page.getByText('☆ star', { exact: false }).first().click()
  await page.waitForTimeout(200)
  await page.getByText('☆ star', { exact: false }).first().click()
  await page.waitForTimeout(200)
  ok((await page.locator('text=/findings starred/').first().innerText()).includes('2'), 'sticky bar shows 2 starred')

  await page.getByRole('button', { name: '⧉ copy' }).first().click()
  await page.waitForTimeout(300)
  let clip = ''
  try { clip = await page.evaluate(() => navigator.clipboard.readText()) } catch (e) { clip = 'ERR' }
  ok(clip.length > 50 && clip !== 'ERR', `finding copy writes to clipboard (${clip.length} chars)`)

  console.log('\n— STATE PERSISTENCE —')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  ok(path() === '/digest/lab', `refresh STAYS on the lab page (got ${path()})`)
  const starredAfter = (await page.locator('text=/findings starred/').count())
    ? await page.locator('text=/findings starred/').first().innerText()
    : 'none'
  ok(starredAfter.includes('2'), `starred count survives refresh (${starredAfter.trim()})`)

  console.log('\n— COMPOSE —')
  await page.getByRole('button', { name: /write an email/i }).click()
  await page.waitForURL('**/digest/compose', { timeout: 20000 })
  await page.waitForSelector('textarea', { timeout: 10000 })
  const skel = await page.locator('textarea').inputValue()
  ok(skel.includes('Test Student'), 'skeleton has the name')
  ok(skel.includes('Sophomore') && skel.includes('Bioinformatics'), 'skeleton has year + major')
  ok(skel.includes('Dear Professor'), 'skeleton greets the PI')
  ok(/~15 min|conversation/.test(skel), 'default meeting ask present')

  await page.getByRole('button', { name: 'Offer to volunteer' }).click()
  await page.waitForTimeout(300)
  ok((await page.locator('textarea').inputValue()).includes('volunteer'), 'ask switches to volunteer')

  await page.getByText('See real emails that got responses').click()
  await page.waitForTimeout(300)
  ok((await page.getByText('Why these lines work').count()) >= 1, 'annotated example emails render')

  await page.getByText(/Star more research/).click()
  await page.waitForTimeout(400)
  ok((await page.getByText('☆ star', { exact: false }).count()) > 0, 'star-more panel shows unstarred findings')

  await page.goBack()
  await page.waitForTimeout(500)
  ok(path() === '/digest/lab', 'browser-back returns to the lab page')
} finally {
  console.log(`\n==== ${pass} passed, ${fail} failed | console/page errors: ${errs.length} ====`)
  if (errs.length) console.log(errs.slice(0, 6))
  await browser.close()
  try { process.kill(-server.pid) } catch { /* already dead */ }
}
process.exit(fail > 0 || errs.length > 0 ? 1 : 0)
