export {} // module scope
// Backfill lab_name for done labs that lack one, using the house convention "{Surname} Lab"
// (matches the existing corpus: "Rana Lab", "Ay Lab", …). Surname via nameParts so comma-format
// and suffixed names ("Sylvia Evans, Ph.D.") resolve correctly. Only writes where lab_name is empty.
//   npx tsx scripts/backfill-lab-name.ts            → dry run
//   npx tsx scripts/backfill-lab-name.ts --execute  → write
process.loadEnvFile('.env.local')

import { nameParts } from '../lib/name-match'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const execute = process.argv.includes('--execute')
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const labs = rows(await sql.query(
    `SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' AND (lab_name IS NULL OR lab_name='') ORDER BY pi_name`,
  ))

  const plan: Array<{ url: string; name: string; pi: string }> = []
  const skip: Array<string> = []
  for (const l of labs) {
    const p = nameParts(l.pi_name as string)
    const surname = p.lasts[p.lasts.length - 1]
    if (!surname) {
      skip.push(l.pi_name as string)
      continue
    }
    const name = `${surname[0].toUpperCase()}${surname.slice(1)} Lab`
    plan.push({ url: l.lab_url as string, name, pi: l.pi_name as string })
  }

  console.log(`${execute ? 'WRITING' : 'DRY'} — lab_name backfill (${plan.length}):`)
  for (const p of plan) console.log(`  ${p.pi.padEnd(28)} → "${p.name}"`)
  if (skip.length) console.log(`\nSKIPPED — no derivable surname (${skip.length}): ${skip.join(', ')}`)

  if (execute) {
    for (const p of plan)
      await sql.query(`UPDATE lab_profiles SET lab_name = $2 WHERE lab_url = $1 AND (lab_name IS NULL OR lab_name='')`, [p.url, p.name])
    console.log(`\n✓ wrote ${plan.length} lab_names.`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
