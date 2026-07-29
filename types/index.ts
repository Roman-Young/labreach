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
  // Populated ONLY on the ingestion path (student-agnostic lab research). The
  // email path leaves this undefined. Mapped into a LabProfile by ingestion.
  labExtraction?: {
    school: string | null
    department: string | null
    researchAreas: string[]
    researchSummary: string | null
    techniques: EvidenceItem[]
    projects: EvidenceItem[]
    organisms: string[]
    dataModality: { value: DataModality | null; evidence: EvidenceItem | null }
    teamComposition: EvidenceItem[]
    recruiting: { status: RecruitingStatus; evidence: EvidenceItem | null }
  }
  // Raw harvested page markdown (url -> markdown), captured during ingestion so a
  // future re-extraction never has to re-scrape. Populated by researchLab; the
  // email path leaves it undefined.
  rawPages?: Record<string, string>
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

// ── LabProfile: the cached, quote-backed record of one lab in the UCSD DB ──
// Structured around the CONNECTION TYPES the ranker scores on, so matching a
// student to a lab is a field-by-field comparison, not one fuzzy blob. Every
// substantive field is quote-backed (EvidenceItem) or null — nothing enters
// without a verbatim source. Fed by ingestion (researchLab), read by the fit
// ranker + the digest. rawPages is retained so RAG/relevance always has the
// full text and we can re-extract without re-scraping. See PHASE_C_SPEC.md.

export type DataModality = 'wet' | 'dry' | 'mixed'

// recruiting: 'explicit_no' is the ONLY hard bar in the product (a lab that
// explicitly declines undergrads). Everything else stays visible/rankable.
export type RecruitingStatus = 'explicit_no' | 'open' | 'unknown'

export interface LabProfile {
  // identity / contact
  labUrl: string
  labName: string | null
  piName: string | null
  piTitle: string | null
  piEmail: string | null

  // placement (cheap filtering; school matters once we scale past bio)
  school: string | null // e.g. "Biological Sciences", "Medicine"
  department: string | null // e.g. "Neurobiology", "Microbiology"
  researchAreas: string[] // topical tags — domain overlap

  // matchable signals — each maps to a connection type
  researchSummary: string | null // 1-2 line readable overview (digest header)
  findings: EvidenceItem[] // actual discoveries/claims
  openProblems: EvidenceItem[] // future directions — the "problem" connection
  techniques: EvidenceItem[] // methods used — "method" connection + modality read
  projects: EvidenceItem[] // ongoing research projects/thrusts — the "project" connection
  organisms: string[] // model systems — the "system" connection
  dataModality: { value: DataModality | null; evidence: EvidenceItem | null } // wet/dry
  teamComposition: EvidenceItem[] // roles on team page — complementarity
  recruiting: { status: RecruitingStatus; evidence: EvidenceItem | null } // the bar

  // provenance / cache
  publications: PublicationRef[]
  rawPages: Record<string, string> | null // harvested markdown by page type
  researchQuality: 'good' | 'limited' | null
  lastRefreshed: string | null // ISO timestamp
}
