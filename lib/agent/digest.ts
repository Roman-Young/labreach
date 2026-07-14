import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { scrapePage } from '@/lib/scraper'
import { searchPubMed } from '@/lib/pubmed'
import { withRetry } from '@/lib/retry'
import { groundedValueOrNull } from './grounding'
import { researchModel } from './models'
import type { LabDigestEntry, JoinLogistics, StudentProfile, EvidenceItem } from '@/types'

const RECENT_WINDOW_YEARS = 3

interface RawExtraction {
  labName: string
  piName: string
  piEmail: string
  whatTheyWorkOn: string
  evidence: Array<{ quote: string; source: string }>
  hoursExpected: string
  mechanism: string
  prerequisites: string
  contactInstructions: string
  recruitingNote: string
}

const EXTRACTION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    labName: { type: SchemaType.STRING, description: 'Lab or research group name' },
    piName: { type: SchemaType.STRING, description: "The principal investigator's full name (first and last). Look in the page title, headers, 'about'/'PI'/'contact' text, and any email address. If only a surname is available (e.g. from the lab name 'Jin Lab'), return just the surname. Empty string only if no name is present at all." },
    piEmail: { type: SchemaType.STRING, description: "The PI's email if shown, else empty string" },
    whatTheyWorkOn: {
      type: SchemaType.STRING,
      description: '1-2 plain sentences describing what this lab actually works on. Specific, not "they study biology".',
    },
    evidence: {
      type: SchemaType.ARRAY,
      description: '1-3 EXACT verbatim quotes from the page that back your whatTheyWorkOn summary. Character-for-character, not paraphrased.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          quote: { type: SchemaType.STRING },
          source: { type: SchemaType.STRING, description: 'e.g. "Lab homepage", "Research page"' },
        },
        required: ['quote', 'source'],
      },
    },
    hoursExpected: { type: SchemaType.STRING, description: 'EXACT verbatim text stating an hours/week expectation, else empty string. Do not infer.' },
    mechanism: { type: SchemaType.STRING, description: 'EXACT verbatim text naming how to join (course codes like BILD99/BISP199, a program, an application), else empty string.' },
    prerequisites: { type: SchemaType.STRING, description: 'EXACT verbatim text stating prerequisites/requirements for joining, else empty string.' },
    contactInstructions: { type: SchemaType.STRING, description: 'EXACT verbatim text telling prospective students how to make contact (email X, use a form, a required subject line), else empty string.' },
    recruitingNote: { type: SchemaType.STRING, description: 'EXACT verbatim text ONLY IF the page explicitly states whether they are accepting/not accepting/full on students. Else empty string. Do not infer availability.' },
  },
  required: ['labName', 'piName', 'piEmail', 'whatTheyWorkOn', 'evidence', 'hoursExpected', 'mechanism', 'prerequisites', 'contactInstructions', 'recruitingNote'],
}

function buildPrompt(pageText: string): string {
  return `You are reading a research lab's web page to build a factual digest for an undergraduate deciding where to apply. Extract only what is actually on the page. Never guess, never infer availability, never invent logistics.

Rules:
- whatTheyWorkOn: 1-2 specific plain sentences. What do they actually study?
- evidence: 1-3 EXACT quotes from the page, character-for-character, that support your summary.
- The logistics fields (hoursExpected, mechanism, prerequisites, contactInstructions, recruitingNote) must each be an EXACT verbatim quote from the page, or an empty string if the page does not state it. Do NOT paraphrase and do NOT infer. Most pages will leave most of these empty — that is expected and correct.
- recruitingNote: only fill this if the page explicitly says something about accepting / not accepting / being full on students. An absence of such a statement means empty string.

PAGE CONTENT:
${pageText}`
}

// Match substrings per canonical interest. Exact-word matching is too brittle — a
// "Neuroscience" student should match a lab that says "nervous system / neuronal",
// never the literal word "neuroscience". The interest list is a fixed 14, so a
// curated map is bounded and far more robust than lexical overlap. This drives the
// honest interest sort only; it is never presented as a reply prediction.
const INTEREST_KEYWORDS: Record<string, string[]> = {
  Biochemistry: ['biochem', 'enzyme', 'metaboli', 'protein structure'],
  'Bioengineering / Synthetic Biology': ['bioengineer', 'synthetic biol', 'biomaterial', 'tissue engineer', 'biosensor'],
  'Bioinformatics / Computational Biology': ['bioinformatic', 'computational', 'sequencing', 'machine learning', 'algorithm', 'genomic data'],
  Biophysics: ['biophysic', 'single-molecule', 'single molecule', 'cryo-em', 'cryo em', 'structural biol', 'molecular dynamics'],
  'Drug Development / Pharmacology': ['drug', 'pharmacolog', 'therapeutic', 'small molecule', 'inhibitor'],
  'Genetics & Genomics': ['genetic', 'genomic', 'genome', 'gene expression', 'variant', 'mutation', 'crispr', 'transcript'],
  'Gut Microbiome': ['microbiome', 'microbiota', 'commensal', 'gastrointestinal', 'gut '],
  Immunology: ['immun', 't cell', 't-cell', 'b cell', 'b-cell', 'antibod', 'cytokine', 'inflammat', 'antigen'],
  'Microbiology / Virology': ['microbio', 'bacteri', 'virus', 'viral', 'virolog', 'pathogen', 'phage', 'infect'],
  'Molecular & Cell Biology': ['molecular', 'cell biol', 'cellular', 'signaling', 'signalling', 'organelle', 'membrane'],
  Neuroscience: ['neuro', 'nervous', 'brain', 'synap', 'cognit', 'behavior', 'behaviour'],
  'Oncology / Cancer Biology': ['cancer', 'oncolog', 'tumor', 'tumour', 'metasta', 'carcino', 'malignan'],
  'Public Health / Epidemiology': ['epidemiolog', 'public health', 'population health', 'surveillance', 'outbreak'],
  'Translational Medicine': ['translational', 'clinical', 'patient'],
}

function keywordsFor(interest: string): string[] {
  return (
    INTEREST_KEYWORDS[interest] ??
    interest
      .toLowerCase()
      .split(/[/,&\s]+/)
      .filter((t) => t.length > 3)
  )
}

function computeInterestOverlap(text: string, interests: string[]): number {
  if (!interests.length) return 0
  const hay = text.toLowerCase()
  const matched = interests.filter((interest) => keywordsFor(interest).some((k) => hay.includes(k))).length
  return matched / interests.length
}

function nullIfEmpty(s: string): string | null {
  return s && s.trim() ? s.trim() : null
}

export async function digestLab(labUrl: string, profile: StudentProfile): Promise<LabDigestEntry> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')

  // 1 Firecrawl credit (cached on re-run). This is the only paid call in the digest.
  const markdown = await scrapePage(labUrl)
  const pageText = markdown.slice(0, 15000)

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: researchModel(),
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: EXTRACTION_SCHEMA as any,
    },
  })

  const raw = await withRetry(async () => {
    const res = await model.generateContent(buildPrompt(pageText))
    const parsed = JSON.parse(res.response.text()) as RawExtraction
    return parsed
  })

  // Ground every quoted field against the page text. Anything not found verbatim is
  // discarded — a digest that surfaces a fabricated "12-20 hours" is worse than one
  // that says nothing.
  const corpus = [pageText]

  const evidence: EvidenceItem[] = (raw.evidence ?? [])
    .filter((e) => groundedValueOrNull(e.quote, corpus) !== null)
    .map((e) => ({ quote: e.quote, source: e.source, sourceType: 'lab_website' as const }))

  const logistics: JoinLogistics = {
    hoursExpected: groundedValueOrNull(raw.hoursExpected, corpus),
    mechanism: groundedValueOrNull(raw.mechanism, corpus),
    prerequisites: groundedValueOrNull(raw.prerequisites, corpus),
    contactInstructions: groundedValueOrNull(raw.contactInstructions, corpus),
    recruitingNote: groundedValueOrNull(raw.recruitingNote, corpus),
  }

  const piName = (raw.piName || '').trim()

  // PubMed (free): most recent paper year + a recent-window volume as a flood proxy.
  // Only search when we have a real full name (2+ tokens) — a bare surname like "Jin"
  // returns thousands of unrelated authors, so an honest null beats a noisy number.
  let mostRecentPaperYear: number | null = null
  let publicationVolume: number | null = null
  if (piName.split(/\s+/).length >= 2 && !/unknown/i.test(piName)) {
    try {
      const pubs = await searchPubMed(piName, 20)
      const years = pubs.map((p) => parseInt(p.year, 10)).filter((y) => !Number.isNaN(y))
      if (years.length) {
        mostRecentPaperYear = Math.max(...years)
        const cutoff = new Date().getFullYear() - RECENT_WINDOW_YEARS
        publicationVolume = years.filter((y) => y >= cutoff).length
      }
    } catch {
      // leave both null
    }
  }

  const overlapText = [raw.whatTheyWorkOn, ...evidence.map((e) => e.quote)].join(' ')

  return {
    labUrl,
    labName: raw.labName || 'Unknown lab',
    piName: piName || 'Unknown PI',
    piEmail: nullIfEmpty(raw.piEmail),
    whatTheyWorkOn: raw.whatTheyWorkOn || '',
    mostRecentPaperYear,
    publicationVolume,
    logistics,
    interestOverlap: computeInterestOverlap(overlapText, profile.interests),
    evidence,
  }
}
