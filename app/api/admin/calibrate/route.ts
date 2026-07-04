import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet, KV_KEYS } from '@/lib/kv'
import { checkAdminAuth } from '@/lib/admin-auth'
import { updateCalibrationSynthesis } from '@/lib/agent/calibration-synthesis'
import type { EvaluatorLogEntry } from '@/lib/agent/eval-log'
import type { HumanLabel } from '@/types'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const offset = Number(searchParams.get('offset') ?? '0')
  const limit = Number(searchParams.get('limit') ?? '20')

  const [logRaw, labelsRaw] = await Promise.all([
    kvGet(KV_KEYS.evaluatorLog),
    kvGet(KV_KEYS.calibrationLabels),
  ])

  const log: EvaluatorLogEntry[] = logRaw ? JSON.parse(logRaw) : []
  const labels: Record<string, HumanLabel> = labelsRaw ? JSON.parse(labelsRaw) : {}

  // Most recent first
  const sorted = [...log].sort((a, b) => b.timestamp - a.timestamp)
  const page = sorted.slice(offset, offset + limit)

  const entries = page.map((entry) => ({
    timestamp: entry.timestamp,
    labName: entry.labName,
    piName: entry.piName,
    subject: entry.subject,
    body: entry.body,
    evidence: entry.evidence,
    verdict: entry.verdict,
    humanLabel: labels[String(entry.timestamp)] ?? null,
  }))

  return NextResponse.json({ entries, total: sorted.length })
}

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { entryTimestamp: number; humanLabel: Omit<HumanLabel, 'labeledAt'> }
  const { entryTimestamp, humanLabel } = body

  if (!entryTimestamp || !humanLabel) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const raw = await kvGet(KV_KEYS.calibrationLabels)
  const labels: Record<string, HumanLabel> = raw ? JSON.parse(raw) : {}
  labels[String(entryTimestamp)] = { ...humanLabel, labeledAt: Date.now() }
  await kvSet(KV_KEYS.calibrationLabels, JSON.stringify(labels))

  // Re-synthesize writer coaching every 5th label (always for the first 5, then every 5th
  // after) — same cadence as /train's synthesis. Fire-and-forget, never blocks the response.
  const labelCount = Object.keys(labels).length
  if (labelCount <= 5 || labelCount % 5 === 0) {
    updateCalibrationSynthesis().catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
