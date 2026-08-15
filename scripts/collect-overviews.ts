export {} // module scope
// Merge the Sonnet distillation batch outputs (data/agent-overviews/<inst>-batch*.json, each a
// {labName: overview} object) into per-institute data/<inst>-overviews.json, which
// wave2-write-profiles.ts consumes. Non-empty overviews only. Idempotent.
//   npx tsx scripts/collect-overviews.ts
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'

const dir = 'data/agent-overviews'
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /-batch\d+\.json$/.test(f)) : []
const byInst: Record<string, Record<string, string>> = {}

let batches = 0, entries = 0, empties = 0
for (const f of files) {
  const inst = f.replace(/-batch\d+\.json$/, '')
  let obj: Record<string, string>
  try { obj = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) } catch (e) { console.log(`  ✗ unparseable ${f}: ${(e as Error).message.slice(0, 80)}`); continue }
  batches++
  byInst[inst] ??= {}
  for (const [name, ov] of Object.entries(obj)) {
    if (typeof ov === 'string' && ov.trim().length >= 80) { byInst[inst][name] = ov.trim(); entries++ }
    else empties++
  }
}

for (const [inst, map] of Object.entries(byInst)) {
  writeFileSync(`data/${inst}-overviews.json`, JSON.stringify(map, null, 2))
  console.log(`  wrote data/${inst}-overviews.json — ${Object.keys(map).length} overviews`)
}
console.log(`\nmerged ${batches} batch files → ${entries} overviews kept, ${empties} empty/too-short skipped`)
