// LabReach ingestion CLI.  Run:  npx tsx scripts/ingest.ts <command> [flags]
//
//   seed                          load data/ucsd-labs.json into the queue (pending)
//   run [--sample N | --limit N] [--concurrency C=5] [--only DEPT] [--retry-failed]
//                                 harvest+extract labs → cache raw pages + store profile/chunks
//   reextract [--limit N] [--only DEPT]   re-derive from cached raw pages (NO Firecrawl)
//   status                        counts by status × department
//
// --sample N spreads N labs across departments (good for a spot check); --limit N
// takes the first N. Resumable: run only touches pending (+ failed with --retry-failed).

process.loadEnvFile('.env.local')

type Enumerated = { url?: string; name?: string; title?: string; department?: string; school?: string }

async function main() {
  const fs = await import('node:fs')
  const [cmd, ...rest] = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const has = (name: string) => rest.includes(`--${name}`)
  const num = (name: string): number | undefined => {
    const v = flag(name)
    return v ? parseInt(v, 10) : undefined
  }

  // ── seed ──────────────────────────────────────────────────────────────
  if (cmd === 'seed') {
    const { seedLabs } = await import('../lib/rag/store')
    const labs = JSON.parse(fs.readFileSync('data/ucsd-labs.json', 'utf-8')) as Enumerated[]
    const withUrl = labs.filter((l) => l.url)
    const n = await seedLabs(
      withUrl.map((l) => ({
        labUrl: l.url as string,
        piName: l.name ?? null,
        department: l.department ?? null,
        school: l.school ?? null,
      })),
    )
    console.log(`seeded/updated ${n} labs (of ${labs.length}; ${labs.length - withUrl.length} skipped — no URL)`)
    return
  }

  // ── status ────────────────────────────────────────────────────────────
  if (cmd === 'status') {
    const { statusCounts } = await import('../lib/rag/store')
    const counts = await statusCounts()
    const byStatus: Record<string, number> = {}
    for (const c of counts) byStatus[c.status] = (byStatus[c.status] ?? 0) + c.count
    console.log('by status:', byStatus)
    console.log('\nby department × status:')
    for (const c of counts) console.log(`  ${c.department.padEnd(32)} ${c.status.padEnd(8)} ${c.count}`)
    return
  }

  // ── run (harvest + extract) ─────────────────────────────────────────────
  if (cmd === 'run') {
    const { ingestLabV2 } = await import('../lib/ingest')
    const { getLabs, markFailed, markNoSources } = await import('../lib/rag/store')
    const { mapWithConcurrency } = await import('../lib/pool')

    const sample = num('sample')
    const limit = num('limit')
    const concurrency = num('concurrency') ?? 5
    const timeoutMs = (num('timeout') ?? 150) * 1000 // per-lab wall-clock budget
    const only = flag('only')
    // --retry-failed also re-runs no_sources labs: that status is reached when a lab yields
    // 0 papers, which can happen from a TRANSIENT all-source outage, not just genuine
    // emptiness. Re-running is cheap (a truly empty lab just fails fast again) and it means
    // no transient failure can permanently bury a real lab. (B4 belt: terminal only after a
    // deliberate retry pass still finds nothing.)
    const status = has('retry-failed') ? ['pending', 'failed', 'no_sources'] : ['pending']

    // Race one lab's ingest against a wall-clock budget. A lab that hangs (slow scrape,
    // retry storm on a huge bundle) must not hold its concurrency slot forever — time it
    // out, mark it failed, and move on; a later smaller/slower --retry-failed pass gets it.
    const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout>
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`timeout after ${ms / 1000}s (${label})`)), ms)
      })
      return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
    }

    const all = await getLabs({ status, department: only })
    let labs = all
    if (sample && all.length > sample) {
      const step = Math.max(1, Math.floor(all.length / sample))
      labs = all.filter((_, i) => i % step === 0).slice(0, sample) // spread across departments
    } else if (limit) {
      labs = all.slice(0, limit)
    }

    console.log(`running ingest on ${labs.length} labs (concurrency ${concurrency})...\n`)
    let done = 0
    let failed = 0
    let noSources = 0
    const seen = () => done + failed + noSources

    // COST CIRCUIT BREAKER: a client-side timeout still BILLS (Gemini generated the output
    // before we abort), and so does every retry. So a Gemini outage silently burns credit on
    // wasted attempts — exactly how a batch can cost far more than planned. If the recent
    // failure rate spikes (>=8 of the last 10 completed labs), we abort the run and leave the
    // rest `pending` (no call, no spend). Resume with --retry-failed once Gemini is healthy.
    const recent: boolean[] = []
    let aborted = false
    const record = (ok: boolean): void => {
      recent.push(ok)
      if (recent.length > 12) recent.shift()
      if (!aborted && recent.length >= 10 && recent.filter((x) => !x).length >= 8) {
        aborted = true
        console.log(`\n⛔ CIRCUIT BREAKER: ${recent.filter((x) => !x).length}/${recent.length} recent labs failing — likely a Gemini outage. Aborting to avoid burning credit; resume with --retry-failed when healthy.`)
      }
    }

    const t0 = Date.now()
    await mapWithConcurrency(labs, concurrency, async (lab) => {
      if (aborted) return // circuit open: skip — lab stays pending, no Gemini call, no spend
      try {
        const { chunkCount, paperCount } = await withTimeout(
          ingestLabV2(lab.labUrl, () => {}, lab.piName), timeoutMs, lab.piName ?? lab.labUrl)
        if (chunkCount === 0 && paperCount > 0) {
          // Papers WERE found but 0 chunks survived (guard dropped all, or a transient
          // extract hiccup). Retryable — do NOT bury as terminal no_sources.
          failed++
          await markFailed(lab.labUrl, `0 chunks despite ${paperCount} papers (guard/transient)`)
          console.log(`  ✗ [${seen()}/${labs.length}] ${lab.piName ?? lab.labUrl} — 0 chunks / ${paperCount} papers → retry`)
          record(false)
        } else if (chunkCount === 0) {
          // Genuinely nothing to find: no papers AND no scrapeable site (not a Gemini failure).
          noSources++
          await markNoSources(lab.labUrl)
          console.log(`  ~ [${seen()}/${labs.length}] ${lab.piName ?? lab.labUrl} — no papers/site — no_sources`)
        } else {
          done++
          console.log(`  ✓ [${seen()}/${labs.length}] ${lab.piName ?? lab.labUrl} — ${chunkCount} chunks`)
          record(true)
        }
      } catch (e) {
        failed++
        const msg = (e as Error).message
        await markFailed(lab.labUrl, msg)
        console.log(`  ✗ [${seen()}/${labs.length}] ${lab.piName ?? lab.labUrl} — ${msg.slice(0, 90)}`)
        record(false)
      }
    })
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    console.log(`\ndone: ${done} ok, ${noSources} no_sources, ${failed} failed, ${secs}s${aborted ? ' (ABORTED early by circuit breaker — rest left pending)' : ''}`)
    return
  }

  // ── embed (backfill dense embeddings; resumable) ──────────────────────────
  if (cmd === 'embed') {
    const { backfillEmbeddings, createEmbeddingIndex, assertEmbeddingConsistency } = await import('../lib/rag/embed')
    const limit = num('limit')
    const t0 = Date.now()
    const { embedded, estTokens } = await backfillEmbeddings((m) => console.log(m), limit)
    console.log(`\nembedded ${embedded} chunks (~${estTokens} tokens, ~$${((estTokens / 1e6) * 0.15).toFixed(4)} est) in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
    if (!limit && embedded > 0) {
      console.log('building HNSW index...')
      await createEmbeddingIndex()
      console.log('index built.')
    }
    // Fail loud if a partial run (or an interrupted model migration) left mixed-model vectors — a
    // full run with no --limit should end 100% consistent. Skipped for a --limit sample run.
    if (!limit) { await assertEmbeddingConsistency(); console.log('embedding-model consistency: OK') }
    return
  }

  // ── reextract (re-derive from cached raw pages — NO Firecrawl) ──
  if (cmd === 'reextract') {
    const { requireSql } = await import('../lib/db')
    const { extractFromPages } = await import('../lib/rag/extract')
    const { storeLab } = await import('../lib/rag/store')
    const sql = requireSql()
    const asRows = (r: unknown): Array<Record<string, unknown>> =>
      (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
    const only = flag('only')
    const limit = num('limit')
    const params: unknown[] = []
    let q = `SELECT lab_url, pi_name, department, school, raw_pages FROM lab_profiles
             WHERE raw_pages IS NOT NULL AND status = 'done'`
    if (only) { params.push(only); q += ` AND department = $${params.length}` }
    q += ` ORDER BY lab_url`
    if (limit) { params.push(limit); q += ` LIMIT $${params.length}` }

    const labs = asRows(await sql.query(q, params))
    console.log(`re-extracting ${labs.length} labs from cache (0 Firecrawl calls)...\n`)
    let n = 0
    for (const lab of labs) {
      const raw = (typeof lab.raw_pages === 'string'
        ? JSON.parse(lab.raw_pages)
        : lab.raw_pages) as Record<string, string>
      const { profile, chunks } = await extractFromPages(String(lab.lab_url), raw, {
        piName: (lab.pi_name as string) ?? null,
        department: (lab.department as string) ?? null,
        school: (lab.school as string) ?? null,
      })
      await storeLab(profile, chunks)
      n++
      console.log(`  ✓ ${lab.pi_name ?? lab.lab_url} — ${chunks.length} chunks`)
    }
    console.log(`\nre-extracted ${n} labs from cache`)
    return
  }

  console.log('usage: npx tsx scripts/ingest.ts <seed|run|embed|reextract|status> [flags]')
  process.exit(1)
}

main().catch((e) => {
  console.error('ERROR:', e)
  process.exit(1)
})

export {}
