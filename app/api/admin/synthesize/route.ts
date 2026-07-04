import { NextRequest, NextResponse } from 'next/server'
import { updateLearningSynthesis } from '@/lib/agent/synthesis'
import { kvGet, KV_KEYS } from '@/lib/kv'
import { checkAdminAuth } from '@/lib/admin-auth'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await updateLearningSynthesis()

  const synthesis = await kvGet(KV_KEYS.learningSynthesis)
  return NextResponse.json({ ok: true, synthesis })
}

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [synthesis, sessionsRaw] = await Promise.all([
    kvGet(KV_KEYS.learningSynthesis),
    kvGet(KV_KEYS.trainingLog),
  ])

  const sessionCount = sessionsRaw ? (JSON.parse(sessionsRaw) as unknown[]).length : 0
  return NextResponse.json({ synthesis, sessionCount })
}
