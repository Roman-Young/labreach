// Turn the raw email files into a clean, anonymized dataset for eval:judge.
//
//   evals/corpus/raw/*.{md,txt}   (one email per file; gitignored)
//   evals/corpus/raw/labels-with-names.csv  (surname -> id/outcome; gitignored)
//        -> evals/corpus/emails.json   (id-keyed, gitignored — still contains bodies)
//
// Matching is by PI surname (from the labels file) found in the filename first,
// then in the email's greeting ("Dear Professor X" / "Dear Dr. X"). Longest
// surname wins so "Reck-Peterson" beats "Peters". Anything unmatched is reported
// so you can rename the file — nothing is silently dropped.
//
// Run: node evals/ingest.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import path from 'path'

const ROOT = process.cwd()
const RAW = path.join(ROOT, 'evals/corpus/raw')
const LABELS = path.join(RAW, 'labels-with-names.csv')
const OUT = path.join(ROOT, 'evals/corpus/emails.json')

if (!existsSync(LABELS)) {
  console.error(`Missing ${LABELS}. Put the name-bearing labels there first.`)
  process.exit(1)
}

function parseCsv(text) {
  const rows = []
  let field = '', row = [], inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const rows = parseCsv(readFileSync(LABELS, 'utf8')).filter((r) => r.length > 1)
const header = rows[0]
const I = (n) => header.indexOf(n)
const labels = rows.slice(1).map((r) => ({
  id: r[I('id')],
  corpus: r[I('corpus')],
  replied: r[I('replied')] === '1',
  tag: r[I('tag')] ?? '',
  surnames: (r[I('pi')] ?? '')
    .split(/[_\s]+/)
    .map((t) => t.replace(/^v\d+$|^\d+$/i, '').trim())
    .filter((t) => t.length >= 3),
}))

// surname -> label, longest surname first for greedy matching
const surnameIndex = []
for (const l of labels) for (const s of l.surnames) surnameIndex.push({ surname: s.toLowerCase(), label: l })
surnameIndex.sort((a, b) => b.surname.length - a.surname.length)

const files = readdirSync(RAW).filter((f) => /\.(md|txt)$/i.test(f) && !/labels/i.test(f))
if (files.length === 0) {
  console.error(`No email files found in ${RAW}. Drop the 53 emails there as .md or .txt (one per file) and re-run.`)
  process.exit(1)
}

function matchLabel(filename, content) {
  const fn = filename.toLowerCase()
  // 1) explicit id in filename (e.g. "B02.md")
  const byId = labels.find((l) => fn.includes(l.id.toLowerCase()))
  if (byId) return byId
  // 2) surname in filename
  const inName = surnameIndex.find((s) => fn.includes(s.surname))
  if (inName) return inName.label
  // 3) surname in the greeting line of the body
  const greeting = (content.match(/dear\s+(?:prof(?:essor)?\.?|dr\.?|mr\.?|ms\.?)\s+([^\n,]+)/i)?.[1] ?? '').toLowerCase()
  if (greeting) {
    const inGreeting = surnameIndex.find((s) => greeting.includes(s.surname))
    if (inGreeting) return inGreeting.label
  }
  return null
}

function extractSubject(content) {
  const m = content.match(/^\s*subject:\s*(.+)$/im)
  return m ? m[1].trim() : ''
}

function extractBody(content) {
  // Drop a leading "Subject:" line if present; keep the rest verbatim.
  return content.replace(/^\s*subject:.*$/im, '').trim()
}

const out = []
const unmatched = []
const usedIds = new Set()
for (const file of files) {
  const content = readFileSync(path.join(RAW, file), 'utf8')
  const label = matchLabel(file, content)
  if (!label) { unmatched.push(file); continue }
  if (usedIds.has(label.id)) console.warn(`  warn: ${label.id} matched by more than one file (${file})`)
  usedIds.add(label.id)
  out.push({ id: label.id, corpus: label.corpus, replied: label.replied, tag: label.tag, subject: extractSubject(content), body: extractBody(content) })
}

out.sort((a, b) => a.id.localeCompare(b.id))
writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')

console.log(`Ingested ${out.length}/${labels.length} labels into ${OUT}.`)
const missing = labels.filter((l) => !usedIds.has(l.id)).map((l) => l.id)
if (missing.length) console.log(`  ${missing.length} labels have no email file: ${missing.join(', ')}`)
if (unmatched.length) console.log(`  ${unmatched.length} files matched no label (rename to include the id or PI surname): ${unmatched.join(', ')}`)
