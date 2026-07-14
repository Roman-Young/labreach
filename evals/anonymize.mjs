// Produce the public, anonymized labels file from the name-bearing source.
//
//   evals/corpus/raw/labels-with-names.csv   (gitignored, has real PI surnames)
//        -> evals/corpus/labels.csv           (committed, PI column = stable id)
//
// The repo is public and the corpus records which named professors ignored a
// student, so the names must not ship. Every eval script keys on the id, so they
// run identically with names (locally) or without (a fresh clone).
//
// Run: node evals/anonymize.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'evals/corpus/raw/labels-with-names.csv')
const OUT = path.join(ROOT, 'evals/corpus/labels.csv')

if (!existsSync(SRC)) {
  console.error(`Missing ${SRC}. Put the name-bearing labels there first.`)
  process.exit(1)
}

// Minimal CSV parse that respects double-quoted fields (notes contain commas).
function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
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

function csvField(s) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const rows = parseCsv(readFileSync(SRC, 'utf8')).filter((r) => r.length > 1)
const header = rows[0]
const body = rows.slice(1)
const col = (name) => header.indexOf(name)
const idI = col('id')
const piI = col('pi')
const notesI = col('notes')

// Collect every surname token that appears in the pi column, longest first so
// "Reck-Peterson" is scrubbed before "Peters". Map each to its row id.
const surnameToId = []
for (const r of body) {
  const id = r[idI]
  const pi = r[piI] ?? ''
  for (const tok of pi.split(/[_\s]+/)) {
    const name = tok.replace(/^v\d+$|^\d+$/i, '').trim()
    if (name.length >= 3) surnameToId.push({ name, id })
  }
}
surnameToId.sort((a, b) => b.name.length - a.name.length)

// Names that appear in notes but not the pi column (e.g. a TA referral).
const EXTRA_SCRUB = [{ pattern: /Albert\s+Dang\s+Vhu/gi, replacement: '[a TA]' }]

function scrub(text) {
  let out = text
  for (const { pattern, replacement } of EXTRA_SCRUB) out = out.replace(pattern, replacement)
  for (const { name, id } of surnameToId) {
    out = out.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), id)
  }
  return out
}

const outLines = [header.map(csvField).join(',')]
for (const r of body) {
  const copy = [...r]
  copy[piI] = r[idI] // PI column becomes the id — no surname leaves the repo
  if (notesI >= 0 && copy[notesI]) copy[notesI] = scrub(copy[notesI])
  outLines.push(copy.map(csvField).join(','))
}

writeFileSync(OUT, outLines.join('\n') + '\n', 'utf8')
console.log(`Wrote ${OUT} (${body.length} rows, ${surnameToId.length} surname tokens scrubbed).`)
