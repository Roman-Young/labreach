// Run the live evaluator over the 53 real corpus emails and ask the load-bearing
// question: does ANY quality axis separate the emails that got replies from the
// ones that didn't? The project's thesis says no — prose quality did not predict
// replies — and the canonical negative (B02, the best-written email) should pass
// the same axes the repliers do.
//
// Scores via POST /api/evaluate-adhoc so the judge is the exact evaluator that
// gates real emails. The corpus has no stored evidence bundle (the 2023-24 lab
// pages have changed), so it scores with EMPTY evidence: axes that read the
// evidence (noFabrication) are not interpretable here and are reported separately
// from the evidence-independent axes.
//
// The `voice` axis is gone (WS2): it read a writing sample, passed 100% of both
// repliers and non-repliers, and measured nothing. The judge is now eight axes.
//
// Prereqs: dev server running WITHOUT SITE_PASSWORD, ADMIN_PASSWORD set, and
// evals/corpus/emails.json produced by `node evals/ingest.mjs`.
//
// Run: ADMIN_PASSWORD=... node evals/eval-judge.mjs   (BASE_URL optional)

import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

const ROOT = process.cwd()
const EMAILS = path.join(ROOT, 'evals/corpus/emails.json')
const OUT = path.join(ROOT, 'evals/corpus/judge-results.json')
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const ADMIN = process.env.ADMIN_PASSWORD
const CONCURRENCY = 3

if (!ADMIN) { console.error('Set ADMIN_PASSWORD (must match the running server).'); process.exit(1) }
if (!existsSync(EMAILS)) { console.error(`Missing ${EMAILS}. Run: node evals/ingest.mjs`); process.exit(1) }

const emails = JSON.parse(readFileSync(EMAILS, 'utf8'))

// Evidence-independent axes — the honest ones for this run.
const INTERPRETABLE = ['opener', 'hookIsFinding', 'bridgeIsBidirectional', 'bridgeIsNonTransferable', 'naturalness', 'wouldSend', 'prohibitions', 'structure']
// Reported but NOT interpretable here (need a real evidence bundle).
const CAVEATED = ['noFabrication', 'hookIsRecent']

function flattenAxes(v) {
  return {
    opener: v.opener.pass,
    hookIsFinding: v.hook.isFinding.pass,
    hookIsRecent: v.hook.isRecent.pass,
    bridgeIsBidirectional: v.bridge.isBidirectional.pass,
    bridgeIsNonTransferable: v.bridge.isNonTransferable.pass,
    noFabrication: v.noFabrication.pass,
    naturalness: v.naturalness.pass,
    wouldSend: v.wouldSend.pass,
    prohibitions: v.prohibitions.pass,
    structure: v.structure.pass,
  }
}

async function score(email) {
  const res = await fetch(`${BASE_URL}/api/evaluate-adhoc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN },
    body: JSON.stringify({ draft: { subject: email.subject, body: email.body }, evidence: {} }),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

const results = []
let idx = 0
async function worker() {
  while (idx < emails.length) {
    const email = emails[idx++]
    try {
      const r = await score(email)
      results.push({ id: email.id, replied: email.replied, tag: email.tag, failedOpen: r.evaluatorFailedOpen, axes: flattenAxes(r.verdict) })
      process.stdout.write('.')
    } catch (e) {
      results.push({ id: email.id, replied: email.replied, tag: email.tag, error: String(e.message ?? e) })
      process.stdout.write('x')
    }
  }
}

console.log(`Scoring ${emails.length} emails via ${BASE_URL} ...`)
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log('\n')

const scored = results.filter((r) => r.axes && !r.failedOpen)
const failedOpen = results.filter((r) => r.failedOpen).length
const errored = results.filter((r) => r.error).length
const replied = scored.filter((r) => r.replied)
const notReplied = scored.filter((r) => !r.replied)

function passRate(group, axis) {
  if (!group.length) return null
  return group.filter((r) => r.axes[axis]).length / group.length
}
const pct = (x) => (x === null ? '  — ' : `${Math.round(x * 100).toString().padStart(3)}%`)

function reportBlock(title, axesList) {
  console.log(`\n${title}`)
  console.log(`  ${'axis'.padEnd(26)} ${'replied'.padStart(8)} ${'no-reply'.padStart(9)} ${'gap'.padStart(6)}`)
  for (const axis of axesList) {
    const r = passRate(replied, axis)
    const nr = passRate(notReplied, axis)
    const gap = r !== null && nr !== null ? r - nr : null
    console.log(`  ${axis.padEnd(26)} ${pct(r)}    ${pct(nr)}   ${gap === null ? '  —' : `${gap >= 0 ? '+' : ''}${Math.round(gap * 100)}`}`)
  }
}

console.log(`Scored ${scored.length}/${emails.length}  (replied ${replied.length}, no-reply ${notReplied.length}; ${failedOpen} fail-open, ${errored} errored — excluded)`)
reportBlock('EVIDENCE-INDEPENDENT AXES (interpretable) — thesis predicts ~0 gap everywhere:', INTERPRETABLE)
reportBlock('CAVEATED AXES (need a real evidence bundle — NOT interpretable on this corpus):', CAVEATED)

// The named negative control: B02 should pass the interpretable axes despite silence.
const b02 = scored.find((r) => r.id === 'B02')
if (b02) {
  const passed = INTERPRETABLE.filter((a) => b02.axes[a])
  console.log(`\nB02 (best-written email, got silence): passes ${passed.length}/${INTERPRETABLE.length} interpretable axes — ${passed.join(', ')}`)
}

writeFileSync(OUT, JSON.stringify({ scoredAt: new Date().toISOString(), n: scored.length, results }, null, 2), 'utf8')
console.log(`\nFull per-email results written to ${OUT}`)
