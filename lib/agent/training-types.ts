// Shared training/calibration types. These used to be defined inside the admin/sessions API route,
// which meant the writer/calibration lib (examples.ts, synthesis.ts) imported types from a route
// file — an anti-pattern that broke when that route was archived (2026-08-07 launch cleanup). Types
// live here now, next to their consumers, so lib/agent stays self-contained (it's still load-bearing
// for the ingestion pipeline via researchLab → writer → examples).

export interface SessionEntry {
  subject: string
  body: string
  feedback?: string
}

export interface TrainingSession {
  labUrl: string
  labName: string
  timestamp: number
  draftCount: number
  finalDraft: { subject: string; body: string }
  feedbackNotes: string[]
  fullHistory?: SessionEntry[]
  experienceLevel?: string
  interests?: string[]
  researchContext?: {
    specificHook: string
    bridgeSentence: string
    agentNote: string
    labName: string
    piName: string
    piEmail: string
    publicationsUsed: Array<{ title: string; source: string; pmid?: string }>
  }
}
