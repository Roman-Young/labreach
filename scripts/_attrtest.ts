export {}
process.loadEnvFile('.env.local')
import { nameParts } from '../lib/name-match'
import { classifyPaper, fetchPaperAuthors } from '../lib/attribution'
async function main() {
  // [pi, sourceId, expected, note]
  const cases: Array<[string, string, string, string]> = [
    ['Sylvia Evans, Ph.D.', 'doi:10.1103/physrevlett.132.065102', 'contaminant', 'fusion physics paper'],
    ['Sylvia Evans, Ph.D.', 'doi:10.1161/circresaha.125.327701', 'confirmed', 'her real cardiac paper'],
    ['Sylvia Evans, Ph.D.', 'doi:10.1016/j.ijrobp.2025.08.067', 'contaminant', 'Suzanne B Evans radiation-onc'],
    ['Ferhat Ay', 'doi:10.1016/j.crmeth.2025.101214', 'confirmed', 'his own DiffHiChIP tool (2-char surname)'],
    ['Shermin de Silva', 'doi:10.1001/jamadermatol.2014.2494', 'contaminant', 'dermatology paper'],
    ['Li-Fan Lu', 'doi:10.1016/j.immuni.2019.11.003', 'confirmed', '2-char surname false-flag from v3'],
    ['Geert Schmid-Schoenbein', 'doi:10.1038/s41598-018-35606-x', '?', 'hyphenated surname (RUPP paper — unknown truth)'],
    ['Yishi Jin', 'doi:10.1021/acsami.6c04520', 'contaminant', 'wearable sensors paper'],
    ['Randy Hampton', 'doi:10.1074/jbc.ra118.001808', 'confirmed', 'nickname: Randy=Randolph, UCSD affil'],
    ['Assutina Sacco, M.D.', 'doi:10.1016/s1470-2045(21)00136-4', 'confirmed', 'typo in our pi_name: Assutina vs real Assuntina'],
  ]
  let pass = 0, total = 0
  for (const [pi, sid, expected, note] of cases) {
    const authors = await fetchPaperAuthors(sid)
    if (!authors) { console.log(`?? ${pi} / ${note}: could not fetch`); continue }
    const v = classifyPaper(authors, nameParts(pi))
    const ok = expected === '?' ? '·' : v === expected ? '✓' : '✗'
    if (expected !== '?') { total++; if (v === expected) pass++ }
    console.log(`${ok} ${pi.padEnd(28)} ${v.padEnd(12)} (expected ${expected}) — ${note}`)
    await new Promise((r) => setTimeout(r, 200))
  }
  console.log(`\n${pass}/${total} expected verdicts correct`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
