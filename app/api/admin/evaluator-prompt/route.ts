import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet, kvDelete, KV_KEYS } from '@/lib/kv'
import { checkAdminAuth } from '@/lib/admin-auth'
import {
  DEFAULT_EVALUATOR_PROMPT,
  evaluatorPromptVersionOf,
  missingEvaluatorPlaceholders,
} from '@/lib/agent/evaluator'

export const maxDuration = 30

// Manage the active evaluator prompt that gates real emails.
// - GET: return the saved (active) prompt if any, plus the code default.
// - POST { evaluatorPrompt }: save it (validated to keep placeholders).
// - DELETE: reset to the code default (removes the saved override).

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const saved = await kvGet(KV_KEYS.evaluatorPrompt)
  const isCustom = !!(saved && saved.trim())
  const activePrompt = isCustom ? (saved as string) : DEFAULT_EVALUATOR_PROMPT

  return NextResponse.json({
    activePrompt,
    isCustom,
    activeVersion: evaluatorPromptVersionOf(activePrompt),
    defaultPrompt: DEFAULT_EVALUATOR_PROMPT,
    defaultVersion: evaluatorPromptVersionOf(DEFAULT_EVALUATOR_PROMPT),
  })
}

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { evaluatorPrompt?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const prompt = body.evaluatorPrompt
  if (!prompt || !prompt.trim()) {
    return NextResponse.json({ error: 'Missing evaluatorPrompt' }, { status: 400 })
  }

  const missing = missingEvaluatorPlaceholders(prompt)
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Prompt is missing required placeholders: ${missing.join(', ')}. The evaluator fills these with the email and evidence — without them it can't see the draft.` },
      { status: 400 },
    )
  }

  await kvSet(KV_KEYS.evaluatorPrompt, prompt)
  return NextResponse.json({ ok: true, version: evaluatorPromptVersionOf(prompt) })
}

export async function DELETE(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await kvDelete(KV_KEYS.evaluatorPrompt)
  return NextResponse.json({
    ok: true,
    defaultVersion: evaluatorPromptVersionOf(DEFAULT_EVALUATOR_PROMPT),
  })
}
