import { createHash } from 'crypto'
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { scrapePage } from '@/lib/scraper'
import { searchPubMed, fetchAbstract } from '@/lib/pubmed'
import { withRetry } from '@/lib/retry'
import { kvGet, kvSet } from '@/lib/kv'
import { groundedValueOrNull } from './grounding'
import { researchModel } from './models'
import type {
  LabDigestEntry,
  LabResearchBundle,
  LabFinding,
  LabExtrapolation,
  JoinLogistics,
  PublicationRef,
  StudentProfile,
} from '@/types'

const RECENT_WINDOW_YEARS = 3
// Findings whose source paper is older than this many years are dropped from the bundle.
// Enforceable on papers (we know their year); best-effort on website prose (year unknown).
const RECENCY_MAX_AGE_YEARS = 4
const MAX_ABSTRACTS = 4 // recent abstracts to read per lab (fetched in parallel; PubMed is free)
const BUNDLE_TTL_SECONDS = 60 * 24 * 60 * 60 // 60 days — labs change; a stale bundle undercuts recency
const BUNDLE_KEY_PREFIX = 'bundle:v2:' // bump to invalidate cached bundles when the pipeline changes

// ---------------------------------------------------------------------------
// Call 1 — grounded extraction from the lab homepage.
// ---------------------------------------------------------------------------

interface HomepageExtraction {
  labName: string
  piName: string
  piEmail: string
  whatTheyWorkOn: string
  findings: Array<{ quote: string; plainSummary: string; significance: string }>
  methods: string[]
  hoursExpected: string
  mechanism: string
  prerequisites: string
  contactInstructions: string
  recruitingNote: string
}

const HOMEPAGE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    labName: { type: SchemaType.STRING, description: 'Lab or research group name' },
    piName: {
      type: SchemaType.STRING,
      description:
        "The principal investigator's full name (first and last). Look in the page title, headers, 'about'/'PI'/'contact' text, and any email address. If only a surname is available, return just the surname. Empty string only if no name is present.",
    },
    piEmail: { type: SchemaType.STRING, description: "The PI's email if shown, else empty string" },
    whatTheyWorkOn: {
      type: SchemaType.STRING,
      description: '1-2 plain sentences describing what this lab actually works on. Specific, not "they study biology".',
    },
    findings: {
      type: SchemaType.ARRAY,
      description:
        'Up to 3 specific findings, claims, or results stated on the page — not "they study X". Each carries an EXACT verbatim quote plus your own plain-language read. Empty array if the page only lists topics with no specific claim.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          quote: { type: SchemaType.STRING, description: 'EXACT verbatim quote from the page, character-for-character, naming the finding/claim.' },
          plainSummary: { type: SchemaType.STRING, description: 'The finding in one plain sentence a curious sophomore would understand.' },
          significance: { type: SchemaType.STRING, description: 'One sentence on why this is scientifically interesting or what it could matter for. Your interpretation, grounded in the quote — not hype.' },
        },
        required: ['quote', 'plainSummary', 'significance'],
      },
    },
    methods: {
      type: SchemaType.ARRAY,
      description: 'Up to 4 notable or unusual methods/techniques this lab uses, each in plain language (e.g. "single-cell RNA sequencing", "cryo-EM"). Empty array if none are named.',
      items: { type: SchemaType.STRING },
    },
    hoursExpected: { type: SchemaType.STRING, description: 'EXACT verbatim text stating an hours/week expectation, else empty string. Do not infer.' },
    mechanism: { type: SchemaType.STRING, description: 'EXACT verbatim text naming how to join (course codes, a program, an application), else empty string.' },
    prerequisites: { type: SchemaType.STRING, description: 'EXACT verbatim text stating prerequisites, else empty string.' },
    contactInstructions: { type: SchemaType.STRING, description: 'EXACT verbatim text telling prospective students how to make contact, else empty string.' },
    recruitingNote: { type: SchemaType.STRING, description: 'EXACT verbatim text ONLY IF the page explicitly states accepting/not accepting/full status. Else empty string. Do not infer.' },
  },
  required: ['labName', 'piName', 'piEmail', 'whatTheyWorkOn', 'findings', 'methods', 'hoursExpected', 'mechanism', 'prerequisites', 'contactInstructions', 'recruitingNote'],
}

function homepagePrompt(pageText: string): string {
  return `You are reading a research lab's web page to build a factual, specific research brief for an undergraduate deciding where to apply. Extract only what is actually on the page.

Rules:
- whatTheyWorkOn: 1-2 specific plain sentences.
- findings: each needs an EXACT verbatim quote (character-for-character) that names a specific finding or claim, plus a plain-language summary and one grounded sentence on why it is scientifically interesting. Do not invent findings — if the page only lists topics, return an empty findings array.
- methods: plain-language names of notable techniques the lab uses; empty array if none are stated.
- The logistics fields must each be an EXACT verbatim quote from the page or an empty string. Do NOT paraphrase, do NOT infer. Most pages leave most of these empty — that is expected.

PAGE CONTENT:
${pageText}`
}

// ---------------------------------------------------------------------------
// Call 2 — grounded extraction from recent abstracts + reasoning (significance
// already covered per-finding; here we pull paper findings, extrapolate open
// directions, and flag the single standout finding).
// ---------------------------------------------------------------------------

interface ReasoningExtraction {
  abstractFindings: Array<{ quote: string; sourceIndex: number; plainSummary: string; significance: string }>
  extrapolations: Array<{ direction: string; basedOn: string }>
  standoutQuote: string
}

const REASONING_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    abstractFindings: {
      type: SchemaType.ARRAY,
      description:
        'The most specific findings from the recent abstracts below. Each carries an EXACT verbatim quote from the abstract it came from, the index of that abstract, a plain-language summary, and one grounded sentence of significance. Empty array if no abstracts were provided.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          quote: { type: SchemaType.STRING, description: 'A full sentence copied CHARACTER-FOR-CHARACTER from the abstract text — a real result sentence, NOT the paper title, and NOT paraphrased. If you cannot copy an exact sentence, do not include this finding. This is verified against the abstract and dropped if it does not match.' },
          sourceIndex: { type: SchemaType.NUMBER, description: 'The index (0-based) of the abstract this quote came from.' },
          plainSummary: { type: SchemaType.STRING, description: 'The finding in one plain sentence a curious sophomore would understand (your own words).' },
          significance: { type: SchemaType.STRING, description: 'One sentence on why it is scientifically interesting (your own words, grounded in the quote).' },
        },
        required: ['quote', 'sourceIndex', 'plainSummary', 'significance'],
      },
    },
    extrapolations: {
      type: SchemaType.ARRAY,
      description:
        '2-4 open directions this work could lead to next — genuine "what could they explore from here" possibilities that a curious student might wonder about. Frame each as a possibility or open question, NEVER as advice to the lab or as established fact. Each names which finding it extends.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          direction: { type: SchemaType.STRING, description: 'An open direction/question the work suggests, phrased as possibility ("this could open the door to...", "an open question is whether...").' },
          basedOn: { type: SchemaType.STRING, description: 'Short reference to the finding this extends.' },
        },
        required: ['direction', 'basedOn'],
      },
    },
    standoutQuote: {
      type: SchemaType.STRING,
      description: 'The exact quote (from either the homepage findings or the abstracts) of the single most unique/interesting finding — the one a student should hook onto. Must match one of the quotes verbatim.',
    },
  },
  required: ['abstractFindings', 'extrapolations', 'standoutQuote'],
}

function reasoningPrompt(
  websiteFindings: Array<{ quote: string; plainSummary: string }>,
  abstracts: Array<{ title: string; abstract: string; year: string }>,
): string {
  const websiteBlock = websiteFindings.length
    ? websiteFindings.map((f, i) => `[W${i}] "${f.quote}" — ${f.plainSummary}`).join('\n')
    : '(none)'
  const abstractsBlock = abstracts.length
    ? abstracts.map((a, i) => `[Abstract ${i}] (${a.year}) ${a.title}\n${a.abstract}`).join('\n\n')
    : '(no abstracts available)'

  return `You are helping an undergraduate understand a lab's recent work well enough to find their own angle into it.

Findings already extracted from the lab website:
${websiteBlock}

Recent paper abstracts (read these for specific, recent findings):
${abstractsBlock}

Do three things:
1. abstractFindings: pull the most specific RESULTS from the abstracts. For each, copy one full result sentence CHARACTER-FOR-CHARACTER from the abstract as the quote (never the paper title, never a paraphrase — the quote is verified against the abstract and silently dropped if it is not an exact match). Give the abstract's index, plus your own plain summary and significance. Prefer 1-2 findings per abstract, spread across the abstracts rather than many from one. Empty array only if the abstracts truly contain no quotable result.
2. extrapolations: 2-4 open directions this work could lead to next — the kind of thing a curious student might wonder about. Frame every one as a possibility or open question, never as advice to the lab and never as established fact.
3. standoutQuote: copy the exact quote (from the website findings or the abstracts) of the single most unique/interesting finding — the one worth hooking an email onto.`
}

// ---------------------------------------------------------------------------
// Per-interest keyword map for the honest relatedness sort (never a prediction).
// ---------------------------------------------------------------------------

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

function matchedInterestsOf(text: string, interests: string[]): string[] {
  const hay = text.toLowerCase()
  return interests.filter((interest) => keywordsFor(interest).some((k) => hay.includes(k)))
}

function nullIfEmpty(s: string): string | null {
  return s && s.trim() ? s.trim() : null
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return url.trim()
  }
}

function bundleKeyFor(labUrl: string): string {
  return `${BUNDLE_KEY_PREFIX}${createHash('sha1').update(normalizeUrl(labUrl)).digest('hex')}`
}

// ---------------------------------------------------------------------------
// getLabResearchBundle — the single research pass. Public, cacheable, no student
// data. Checks KV first; on a miss it scrapes + reads abstracts + extracts +
// grounds + caches.
// ---------------------------------------------------------------------------

export async function getLabResearchBundle(labUrl: string): Promise<LabResearchBundle> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')

  const cacheKey = bundleKeyFor(labUrl)
  const cached = await kvGet(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached) as LabResearchBundle
    } catch {
      // fall through and rebuild on a corrupt cache entry
    }
  }

  // 1 Firecrawl credit (disk-cached on re-run).
  const markdown = await scrapePage(labUrl)
  const pageText = markdown.slice(0, 15000)

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: researchModel(),
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: HOMEPAGE_SCHEMA as any,
    },
  })

  const home = await withRetry(async () => {
    const res = await model.generateContent(homepagePrompt(pageText))
    return JSON.parse(res.response.text()) as HomepageExtraction
  })

  const piName = (home.piName || '').trim()

  // PubMed (free): recent-window volume as a flood proxy + the most recent abstracts to
  // actually read. Only when we have a real full name — a bare surname returns noise.
  const currentYear = new Date().getFullYear()
  const recencyCutoff = currentYear - RECENCY_MAX_AGE_YEARS
  let mostRecentPaperYear: number | null = null
  let publicationVolume: number | null = null
  const abstracts: Array<{ title: string; abstract: string; year: string }> = []
  const publications: PublicationRef[] = []

  if (piName.split(/\s+/).length >= 2 && !/unknown/i.test(piName)) {
    try {
      const pubs = await searchPubMed(piName, 20)
      const years = pubs.map((p) => parseInt(p.year, 10)).filter((y) => !Number.isNaN(y))
      if (years.length) {
        mostRecentPaperYear = Math.max(...years)
        publicationVolume = years.filter((y) => y >= currentYear - RECENT_WINDOW_YEARS).length
      }
      // Read the most recent abstracts (already sorted by date) for real paper content.
      // Fetched in parallel so breadth doesn't cost linear latency; order is preserved.
      const fetched = await Promise.all(
        pubs.slice(0, MAX_ABSTRACTS).map(async (p) => {
          try {
            const a = await fetchAbstract(p.pmid)
            return a && a.abstract.trim() ? { p, a } : null
          } catch {
            return null
          }
        }),
      )
      for (const item of fetched) {
        if (!item) continue
        const { p, a } = item
        abstracts.push({ title: a.title || p.title, abstract: a.abstract, year: a.year || p.year })
        publications.push({ title: a.title || p.title, source: 'pubmed', year: a.year || p.year, pmid: p.pmid })
      }
    } catch {
      // leave pubmed-derived fields empty
    }
  }

  // Call 2 — abstract findings + extrapolation + standout flag.
  const reasoningModel = genAI.getGenerativeModel({
    model: researchModel(),
    // Low temperature: the finding quotes must be copied verbatim or grounding drops them.
    // The extrapolations are still specific and useful at this temperature.
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: REASONING_SCHEMA as any,
    },
  })
  let reasoning: ReasoningExtraction = { abstractFindings: [], extrapolations: [], standoutQuote: '' }
  try {
    reasoning = await withRetry(async () => {
      const res = await reasoningModel.generateContent(reasoningPrompt(home.findings ?? [], abstracts))
      return JSON.parse(res.response.text()) as ReasoningExtraction
    })
  } catch {
    // extrapolation is best-effort; a lab with only grounded findings is still useful
  }

  // Ground every quote against what we actually fetched. Anything not verbatim is dropped.
  const corpus = [pageText, ...abstracts.map((a) => `${a.title}\n${a.abstract}`)]

  const websiteFindings: LabFinding[] = (home.findings ?? [])
    .filter((f) => groundedValueOrNull(f.quote, corpus) !== null)
    .map((f) => ({
      quote: f.quote,
      source: 'Lab homepage',
      sourceType: 'lab_website' as const,
      year: null, // website prose rarely carries a reliable date
      plainSummary: f.plainSummary,
      significance: f.significance,
    }))

  const abstractFindings: LabFinding[] = (reasoning.abstractFindings ?? [])
    .filter((f) => groundedValueOrNull(f.quote, corpus) !== null)
    .map((f) => {
      const src = abstracts[f.sourceIndex]
      const year = src ? parseInt(src.year, 10) : NaN
      return {
        quote: f.quote,
        source: src ? `${src.title} (${src.year})` : 'Recent publication',
        sourceType: 'pubmed_abstract' as const,
        year: Number.isNaN(year) ? null : year,
        plainSummary: f.plainSummary,
        significance: f.significance,
      }
    })

  // Recency gate: drop findings whose source paper is older than the cutoff. Findings with
  // an unknown year (website prose) are kept — recency is enforceable on papers, best-effort
  // on prose, and we do not fake a date we do not have.
  let findings = [...websiteFindings, ...abstractFindings].filter(
    (f) => f.year === null || f.year >= recencyCutoff,
  )

  // Put the model-flagged standout finding first, if it survived grounding + recency.
  const standout = (reasoning.standoutQuote || '').trim()
  if (standout) {
    const idx = findings.findIndex((f) => f.quote.includes(standout) || standout.includes(f.quote))
    if (idx > 0) findings = [findings[idx], ...findings.slice(0, idx), ...findings.slice(idx + 1)]
  }

  const hasRecentWork =
    findings.some((f) => f.year !== null && f.year >= recencyCutoff) ||
    (mostRecentPaperYear !== null && mostRecentPaperYear >= recencyCutoff) ||
    // If we have no dated evidence at all, don't claim there is none — only assert "no recent
    // work" when PubMed gave us a year and it is old.
    (mostRecentPaperYear === null && findings.length > 0)

  const logistics: JoinLogistics = {
    hoursExpected: groundedValueOrNull(home.hoursExpected, corpus),
    mechanism: groundedValueOrNull(home.mechanism, corpus),
    prerequisites: groundedValueOrNull(home.prerequisites, corpus),
    contactInstructions: groundedValueOrNull(home.contactInstructions, corpus),
    recruitingNote: groundedValueOrNull(home.recruitingNote, corpus),
  }

  const bundle: LabResearchBundle = {
    labUrl,
    fetchedAt: Date.now(),
    labName: home.labName || 'Unknown lab',
    piName: piName || 'Unknown PI',
    piEmail: nullIfEmpty(home.piEmail),
    whatTheyWorkOn: home.whatTheyWorkOn || '',
    findings,
    methods: (home.methods ?? []).filter((m) => m && m.trim()),
    extrapolations: (reasoning.extrapolations ?? []).filter(
      (e): e is LabExtrapolation => !!e.direction && !!e.direction.trim(),
    ),
    mostRecentPaperYear,
    publicationVolume,
    hasRecentWork,
    logistics,
    publications,
  }

  await kvSet(cacheKey, JSON.stringify(bundle), BUNDLE_TTL_SECONDS)
  return bundle
}

// ---------------------------------------------------------------------------
// digestLab — the per-user view: the shared bundle plus this student's overlap.
// ---------------------------------------------------------------------------

export async function digestLab(labUrl: string, profile: StudentProfile): Promise<LabDigestEntry> {
  const bundle = await getLabResearchBundle(labUrl)

  const overlapText = [
    bundle.whatTheyWorkOn,
    ...bundle.findings.map((f) => `${f.quote} ${f.plainSummary} ${f.significance}`),
    ...bundle.methods,
  ].join(' ')
  const matched = matchedInterestsOf(overlapText, profile.interests)

  return {
    bundle,
    interestOverlap: profile.interests.length ? matched.length / profile.interests.length : 0,
    matchedInterests: matched,
  }
}
