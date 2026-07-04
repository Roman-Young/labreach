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
  experienceLevel: ExperienceLevel
  relevantCourses: string
  relevantExperience: string
  whyResearch: string
  interests: string[]
  otherInterest?: string
  writingSample: string
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
  voice: { pass: boolean; reason: string }
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
  voice: boolean
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
