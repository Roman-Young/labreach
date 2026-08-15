// WAVE-2 PAPER PIPELINE — HARVEST stage (headless, READ-ONLY, no DB, no shell for the browser).
// Reads the work queue (data/wave2-papers/_queue.json = [{name,url}]) and, for a --start/--count
// slice, visits each lab's stored lab_url in headless Chrome, finds its OWN publications page, and
// pulls candidate paper ids (DOIs + plain-text/linked PMIDs + quoted titles + PubMed-collection +
// LJI institutional filtered list). Writes/updates data/wave2-papers/_harvest.json (keyed by name)
// and flags labs with no discoverable pub page into _harvest_failures.json for a human to supply a
// direct link. NEVER writes to the DB. Per-archetype adapters, added as institutions require.
//
//   node scripts/wave2-pub-harvest.mjs --start 0 --count 20
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d }
const START = Number(arg('--start', '0'))
const COUNT = Number(arg('--count', '20'))
const QUEUE = 'data/wave2-papers/_queue.json'
const OUT = 'data/wave2-papers/_harvest.json'
const FAIL = 'data/wave2-papers/_harvest_failures.json'
const PUB_RE = /publication|papers|pubs|research output|selected work/i

const queue = JSON.parse(readFileSync(QUEUE, 'utf8'))
const slice = queue.slice(START, START + COUNT)
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const failures = existsSync(FAIL) ? JSON.parse(readFileSync(FAIL, 'utf8')) : []

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' })

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(3500)
  // Scroll through the page to trigger lazy-loaded content (e.g. Scripps faculty pages hydrate a
  // "Selected Publications" widget on scroll/idle — extracting too early nondeterministically got 0).
  try {
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)) }
      window.scrollTo(0, 0)
    })
  } catch { /* non-fatal */ }
  await page.waitForTimeout(2500)
}
// Poll until the (lazily-hydrated) publication data actually appears, instead of guessing a fixed
// wait — makes extraction deterministic on JS-flaky pages (Scripps faculty "Selected Publications").
async function extractIdsStable(page) {
  let last = await extractIds(page)
  for (let i = 0; i < 5 && (last.dois.length + last.pmids.length) === 0; i++) {
    await page.waitForTimeout(1400)
    last = await extractIds(page)
  }
  return last
}
async function extractIds(page) {
  return await page.evaluate(() => {
    const html = document.body.innerHTML, text = document.body.innerText
    const norm = s => s.toLowerCase().replace(/[.,;)]+$/, '')
    const dois = [...new Set((html.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/gi) || []).map(norm))].filter(d => !/\/v\d+$/.test(d))
    const pmidText = [...text.matchAll(/PMID:?\s*(\d{6,9})/gi)].map(m => m[1])
    const pmidLinks = [...document.querySelectorAll('a')].map(a => (a.href.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/) || [])[1]).filter(Boolean)
    const pmids = [...new Set([...pmidText, ...pmidLinks])]
    const titles = [...new Set([...text.matchAll(/[""]([^""]{25,300})[""]/g)].map(m => m[1].trim().replace(/[",]\s*$/, '')))]
    const collections = [...new Set([...document.querySelectorAll('a')].map(a => a.href).filter(h => /pubmed\.ncbi\.nlm\.nih\.gov\/collections\//i.test(h)))]
    return { dois, pmids, titles, collections, textLen: text.length }
  })
}

// Registrable domain (eTLD+1), so a lab's pub page on a SUBDOMAIN (janda.scripps.edu) still counts
// as "the lab's own site" relative to its faculty page (www.scripps.edu/faculty/janda). Last two
// labels is correct for scripps.edu / salk.edu / lji.org / sbpdiscovery.org and the .com/.org lab
// sites; the downstream author gate (Gate B) is the backstop against any stray cross-site paper.
const host = u => { try { return new URL(u).host.replace(/^www\./, '').split('.').slice(-2).join('.') } catch { return '' } }
const mergeIds = (a, b) => ({
  dois: [...new Set([...a.dois, ...b.dois])], pmids: [...new Set([...a.pmids, ...b.pmids])],
  titles: [...new Set([...a.titles, ...b.titles])], collections: [...new Set([...a.collections, ...b.collections])],
})

for (let i = 0; i < slice.length; i++) {
  const { name, url } = slice[i]
  const p = await ctx.newPage()
  const r = { name, url, method: null, source_page: null, dois: [], pmids: [], titles: [], collections: [] }
  try {
    await goto(p, url)
    // 1. ALWAYS harvest the landing page first — faculty pages often embed a "Selected Publications"
    //    widget with DOIs; navigating away from it (old bug) silently lost them.
    let ids = await extractIdsStable(p)
    const links = await p.evaluate(() => [...document.querySelectorAll('a')].map(a => ({ t: (a.innerText || '').trim(), h: a.href })))
    // 2. Follow up to 2 publications-TEXT links on the lab's OWN host, unioning ids. The PUB_RE text
    //    match already excludes institutional nav ("Research Programs"/"Departments" don't contain
    //    publication/papers/pubs), so same-host is the only extra guard needed. Union means a
    //    dead-end pub link can never REDUCE the ids we already have from the landing page.
    const pubLinks = [...new Map(links.filter(l => l.h && host(l.h) === host(url) && PUB_RE.test(l.t)).map(l => [l.h, l])).values()].slice(0, 2)
    const ljiFiltered = links.find(l => /lji\.org\/research\/publications\/\?.*labs_taxonomy=/i.test(l.h))
    if (ljiFiltered) { await goto(p, ljiFiltered.h); ids = mergeIds(ids, await extractIdsStable(p)); r.method = 'lji-filtered'; r.source_page = ljiFiltered.h }
    else if (pubLinks.length) {
      for (const pub of pubLinks) { try { await goto(p, pub.h); ids = mergeIds(ids, await extractIdsStable(p)) } catch { /* skip */ } }
      r.method = 'doi-page'; r.source_page = pubLinks[0].h
    } else { r.method = 'homepage'; r.source_page = url }
    if (ids.collections.length) {
      await goto(p, ids.collections[0] + (ids.collections[0].includes('?') ? '&' : '?') + 'sort=pubdate')
      ids = mergeIds(ids, await extractIdsStable(p))
      r.method = 'pubmed-collection'; r.source_page = ids.collections[0]
    }
    Object.assign(r, { dois: ids.dois, pmids: ids.pmids, titles: ids.titles, collections: ids.collections })
    const total = r.dois.length + r.pmids.length + r.titles.length
    if (!total) {
      failures.push({ name, url, reason: `pub page reached (${r.method}) but 0 ids/titles extracted`, source_page: r.source_page })
      console.log(`  ✗ ${String(START + i).padStart(3)} ${name.padEnd(28)} ${r.method} — 0 ids`)
    } else {
      out[name] = r
      console.log(`  ✓ ${String(START + i).padStart(3)} ${name.padEnd(28)} ${String(r.method).padEnd(17)} DOIs=${r.dois.length} PMIDs=${r.pmids.length} titles=${r.titles.length}`)
    }
  } catch (e) {
    failures.push({ name, url, reason: 'ERR ' + String(e.message).slice(0, 80) })
    console.log(`  ✗ ${String(START + i).padStart(3)} ${name.padEnd(28)} FAIL ${String(e.message).slice(0, 50)}`)
  }
  await p.close()
}
await b.close()
writeFileSync(OUT, JSON.stringify(out, null, 1))
writeFileSync(FAIL, JSON.stringify(failures, null, 1))
console.log(`\nharvested ${Object.keys(out).length} total | failures ${failures.length} | processed slice [${START}, ${START + slice.length})`)
