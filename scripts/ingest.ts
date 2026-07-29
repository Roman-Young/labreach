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
    const { getLabs, markFailed } = await import('../lib/rag/store')
    const { mapWithConcurrency } = await import('../lib/pool')

    const sample = num('sample')
    const limit = num('limit')
    const concurrency = num('concurrency') ?? 5
    const only = flag('only')
    const status = has('retry-failed') ? ['pending', 'failed'] : ['pending']

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
    const t0 = Date.now()
    await mapWithConcurrency(labs, concurrency, async (lab) => {
      try {
        const { chunkCount } = await ingestLabV2(lab.labUrl, () => {}, lab.piName)
        done++
        console.log(`  ✓ [${done + failed}/${labs.length}] ${lab.piName ?? lab.labUrl} — ${chunkCount} chunks`)
      } catch (e) {
        failed++
        const msg = (e as Error).message
        await markFailed(lab.labUrl, msg)
        console.log(`  ✗ [${done + failed}/${labs.length}] ${lab.piName ?? lab.labUrl} — ${msg.slice(0, 90)}`)
      }
    })
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    console.log(`\ndone: ${done} ok, ${failed} failed, ${secs}s`)
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

  console.log('usage: npx tsx scripts/ingest.ts <seed|run|reextract|status> [flags]')
  process.exit(1)
}

main().catch((e) => {
  console.error('ERROR:', e)
  process.exit(1)
})

export {}
