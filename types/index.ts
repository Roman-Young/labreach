export type ExperienceLevel = 'none' | 'some' | 'significant'

export type StudentYear =
  | 'high_school'
  | 'freshman'
  | 'sophomore'
  | 'junior'
  | 'senior'
  | 'graduate'

export interface StudentProfile {
  name: string
  school: string
  year: StudentYear
  major?: string
  experienceLevel: ExperienceLevel
  // Structured experience, in three buckets. These are what the writer mines for a
  // real, earned connection — the one thing in the 53-email corpus that beat baseline.
  // They replace the old free-text blob and the writing sample (whose `voice` axis
  // passed 100% of both repliers and non-repliers, i.e. measured nothing).
  // A student with no research experience fills courses + projects and leaves
  // `experience` empty. That is expected, not a deficit.
  courses: string      // coursework: "BILD 1, BICD 100, Organic Chemistry"
  experience: string   // hands-on technique / lab work: "PCR, cell culture, one semester in X lab"
  projects: string     // personal or side projects: "built a variant-calling script in Python"
  whyResearch: string
  interests: string[]
  otherInterest?: string
  // Availability — PIs ask for this explicitly (it signals training ROI) and none of the
  // 53 corpus emails stated it. Optional; fed into the email's ask when present.
  hoursPerWeek?: string
  startDate?: string
  duration?: string
}

export interface PublicationRef {
  title: string
  year?: string
  authors?: string
  journal?: string
  source: 'lab_website' | 'pubmed'
  pmid?: string
}

export interface GlossaryEntry {
  term: string
  explanation: string
}

export interface EvidenceItem {
  quote: string
  source: string
  sourceType: 'lab_website' | 'pubmed_abstract' | 'pubmed_full_text'
  note?: string
}

export interface ResearchEvidence {
  candidateFindings: EvidenceItem[]
  openProblems: EvidenceItem[]
  otherQuotableSpecifics: EvidenceItem[]
}

export interface ProhibitionHit {
  phrase: string
  context: string
}

export interface FabricationHit {
  claim: string
  reason: string
}

export interface NaturalnessHit {
  quote: string
  issue: string
}

export interface EvaluatorVerdict {
  opener: { pass: boolean; quote: string | null }
  hook: {
    isFinding: { pass: boolean; quote: string | null }
    isRecent: { pass: boolean; quote: string | null; reason: string }
  }
  bridge: {
    isBidirectional: { pass: boolean; quote: string | null }
    isNonTransferable: { pass: boolean; quote: string | null }
  }
  noFabrication: { pass: boolean; hits: FabricationHit[] }
  naturalness: { pass: boolean; hits: NaturalnessHit[] }
  wouldSend: { pass: boolean; reason: string }
  prohibitions: { pass: boolean; hits: ProhibitionHit[] }
  structure: { pass: boolean; wordCount: number; paragraphCount: number }
  overallPass: boolean
}

export interface HumanLabel {
  opener: boolean
  hookIsFinding: boolean
  hookIsRecent: boolean
  bridgeIsBidirectional: boolean
  bridgeIsNonTransferable: boolean
  noFabrication: boolean
  naturalness: boolean
  wouldSend: boolean
  labeledAt: number
}

export interface AgentResult {
  subject: string
  body: string
  piName: string
  piEmail: string
  labName: string
  publicationsUsed: PublicationRef[]
  evidence: ResearchEvidence
  specificHook: string
  bridgeSentence: string
  agentNote: string
  researchQuality?: 'good' | 'limited'
  termGlossary: GlossaryEntry[]
  evaluatorFlag?: { reason: string; finalVerdict: EvaluatorVerdict; attemptsUsed: number }
}

export type AgentEventType = 'progress' | 'draft' | 'error'

export interface AgentProgressEvent {
  type: 'progress'
  message: string
}

export interface AgentDraftEvent {
  type: 'draft'
  result: AgentResult
}

export interface AgentErrorEvent {
  type: 'error'
  message: string
}

export type AgentEvent = AgentProgressEvent | AgentDraftEvent | AgentErrorEvent


export interface ResearchRequest {
  profile: StudentProfile
  labUrl: string
}

// --- Lab Digest ---------------------------------------------------------------
// The digest reads a lab's homepage and reports facts, never a reply prediction.
// Every quoted field is verbatim from the page (grounded) or null — never guessed.

export interface JoinLogistics {
  hoursExpected: string | null       // e.g. "12-20 hours", verbatim from the page
  mechanism: string | null           // e.g. "BILD99 / BISP199 / BISP196", verbatim
  prerequisites: string | null       // verbatim
  contactInstructions: string | null // e.g. "apply via the form", verbatim
  recruitingNote: string | null      // only if the page explicitly states accept/full status
}

export interface LabDigestEntry {
  labUrl: string
  labName: string
  piName: string
  piEmail: string | null
  whatTheyWorkOn: string             // 1-2 grounded sentences
  mostRecentPaperYear: number | null
  publicationVolume: number | null   // recent-window paper count from PubMed → flood proxy
  logistics: JoinLogistics
  interestOverlap: number            // 0-1, for the honest interest sort only (NOT a prediction)
  evidence: EvidenceItem[]           // grounded quotes backing whatTheyWorkOn
}

export interface DigestRequest {
  profile: StudentProfile
  labUrls: string[]
}

// SSE events streamed by /api/digest as labs finish (concurrency-limited).
export type DigestEventType = 'progress' | 'lab' | 'error' | 'done'

export interface DigestProgressEvent {
  type: 'progress'
  message: string
  completed: number
  total: number
}

export interface DigestLabEvent {
  type: 'lab'
  entry: LabDigestEntry
}

export interface DigestErrorEvent {
  type: 'error'
  labUrl: string
  message: string
}

export interface DigestDoneEvent {
  type: 'done'
}

export type DigestEvent = DigestProgressEvent | DigestLabEvent | DigestErrorEvent | DigestDoneEvent
