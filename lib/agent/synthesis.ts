import { GoogleGenerativeAI } from '@google/generative-ai'
import { kvGet, kvSet, KV_KEYS } from '@/lib/kv'
import { withRetry } from '@/lib/retry'
import { evalModel } from './models'
import type { TrainingSession } from '@/app/api/admin/sessions/route'

export async function updateLearningSynthesis(): Promise<void> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) return

  const raw = await kvGet(KV_KEYS.trainingLog)
  if (!raw) return

  let sessions: TrainingSession[]
  try {
    sessions = JSON.parse(raw)
  } catch {
    return
  }

  const validSessions = sessions.filter((s) => s.finalDraft?.body)
  if (validSessions.length === 0) return

  // Build the full arc for each session
  const sessionDocs = validSessions.map((s, i) => {
    const lines: string[] = []
    lines.push(`SESSION ${i + 1} — ${s.labName} (student experience: ${s.experienceLevel ?? 'unknown'})`)
    lines.push('='.repeat(60))

    if (s.fullHistory?.length) {
      s.fullHistory.forEach((entry, j) => {
        const isLast = j === s.fullHistory!.length - 1
        lines.push(`\n${isLast ? 'APPROVED FINAL' : `Draft ${j + 1}`}:`)
        lines.push(`Subject: ${entry.subject}`)
        lines.push(entry.body)
        if (entry.feedback) {
          lines.push(`\nFeedback on this draft: "${entry.feedback}"`)
        }
      })
    } else {
      // Older sessions without full history
      if (s.feedbackNotes?.length) {
        lines.push(`\nFeedback given during session:`)
        s.feedbackNotes.forEach((note, j) => lines.push(`  ${j + 1}. "${note}"`))
      }
      lines.push(`\nApproved final email:`)
      lines.push(`Subject: ${s.finalDraft.subject}`)
      lines.push(s.finalDraft.body)
    }

    return lines.join('\n')
  })

  const prompt = `You are analyzing ${validSessions.length} cold email training session${validSessions.length > 1 ? 's' : ''}. Each session shows an AI writing cold emails to research lab PIs, receiving human feedback, revising, until a final version was approved.

${sessionDocs.join('\n\n' + '─'.repeat(70) + '\n\n')}

─────────────────────────────────────────────────────────────────────

Based on this complete history, write a PATTERN ANALYSIS addressed directly to the writer. Use "you" throughout — "you tend to...", "when your draft worked, you...", "the feedback consistently told you...". This writer will read this immediately before writing their next email. Make it feel like direct coaching from someone who has watched every session.

Cover:
— What you consistently get wrong in early drafts — be specific about the exact failure modes seen across sessions
— What the human feedback revealed about what professors actually respond to
— What you did differently in the emails that got approved quickly vs. the ones that needed many rounds
— How the student-to-lab connection works when it lands vs. how it collapses in rejected drafts
— What "specific" concretely looks like from the sessions that worked, with examples
— Any patterns specific to students with "some" experience

Be concrete. Reference what actually happened in these sessions. If a mistake appeared in every session, say so — that is the most important thing for the writer to know.`

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: evalModel(),
    generationConfig: { temperature: 0.4 },
  })

  try {
    const result = await withRetry(() => model.generateContent(prompt))
    const synthesis = result.response.text().trim()
    await kvSet(KV_KEYS.learningSynthesis, synthesis)
  } catch {
    // Non-blocking — previous synthesis remains if this fails
  }
}
