import { SchemaType } from '@google/generative-ai'
import { scrapePage } from '@/lib/scraper'
import { searchPubMed, fetchAbstract, getPMCID } from '@/lib/pubmed'
import type { AgentResult, PublicationRef, EvidenceItem, ResearchEvidence } from '@/types'

function extractKeySection(markdown: string): string {
  // Find the first valuable section: Discussion, Future Directions, Conclusions, Significance
  const sectionPattern = /\n#{1,4}\s*(Discussion|Future\s+Directions?|Conclusion[s]?|Significance|Summary)\b/i
  const match = markdown.search(sectionPattern)

  if (match !== -1) {
    // Return from that section onward, up to 7000 chars
    return markdown.slice(match, match + 7000).trim()
  }

  // No labeled section — return last 5000 chars (discussion territory in most papers)
  return markdown.slice(-5000).trim()
}

export const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: 'fetch_webpage',
    description:
      'Fetch the content of a webpage and return it as markdown. Use this to read the lab homepage, publications page, people/team page, or contact page. Do not call this more than 5 times per session.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        url: { type: SchemaType.STRING, description: 'The full URL to fetch' },
        reason: { type: SchemaType.STRING, description: 'Why you are fetching this page' },
      },
      required: ['url', 'reason'],
    },
  },
  {
    name: 'search_pubmed',
    description:
      'Search PubMed for recent publications by a researcher. Use when the lab website has fewer than 3 papers with meaningful descriptions. Returns up to 5 results.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: 'Search query, e.g. "Jane Smith cancer immunology" or "Smith J UCSF immunotherapy"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_pubmed_abstract',
    description:
      'Fetch the full abstract of a PubMed paper by PMID. Use for the 1-2 most relevant papers to get detailed content for the email. Do not call this more than 2 times per session.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        pmid: { type: SchemaType.STRING, description: 'The PubMed ID (e.g. "38123456")' },
      },
      required: ['pmid'],
    },
  },
  {
    name: 'fetch_full_paper',
    description:
      'Fetch the full text of a paper from PubMed Central if it is freely available. Use this on the 1-2 most relevant papers after finding their PMIDs. Returns the Discussion and Future Directions sections — the most valuable content for understanding what the PI wants to study next and building specific connections. Do not call this more than 2 times per session.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        pmid: { type: SchemaType.STRING, description: 'The PubMed ID of the paper' },
        reason: { type: SchemaType.STRING, description: 'Why this paper is relevant to the student' },
      },
      required: ['pmid', 'reason'],
    },
  },
  {
    name: 'finish',
    description:
      'Call this when you have gathered specific, quotable evidence. Extract raw findings only — do NOT compose a hook or bridge sentence, a separate writing agent will do that. Fill in the evidence fields; they are the only output the writing agent needs.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        candidate_findings: {
          type: SchemaType.ARRAY,
          description:
            "2-4 exact quotes of specific findings, mechanisms, or claims from this lab's actual papers or website — not paraphrases. Each needs the exact source (paper title + year + section, or webpage name). If you cannot quote an actual finding, read more before calling finish().",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              quote: { type: SchemaType.STRING, description: 'The exact quote' },
              source: { type: SchemaType.STRING, description: 'e.g. "Smith et al. 2023, Discussion section" or "Lab homepage"' },
              source_type: { type: SchemaType.STRING, description: '"lab_website" | "pubmed_abstract" | "pubmed_full_text"' },
            },
            required: ['quote', 'source', 'source_type'],
          },
        },
        open_problems: {
          type: SchemaType.ARRAY,
          description:
            'Exact quotes from Discussion/Future Directions/Conclusions sections naming open questions or next steps the lab wants to pursue. Empty array if none found.',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              quote: { type: SchemaType.STRING, description: 'The exact quote' },
              source: { type: SchemaType.STRING, description: 'e.g. "Smith et al. 2023, Future Directions"' },
              source_type: { type: SchemaType.STRING, description: '"lab_website" | "pubmed_abstract" | "pubmed_full_text"' },
            },
            required: ['quote', 'source', 'source_type'],
          },
        },
        other_quotable_specifics: {
          type: SchemaType.ARRAY,
          description:
            "Exact quotes of specific methods, named techniques, or notable claims that could support a bridge sentence but aren't the primary finding. Include a brief note on why each might be useful.",
          items: {
            type: SchemaType.OBJECT,
            properties: {
              quote: { type: SchemaType.STRING, description: 'The exact quote' },
              source: { type: SchemaType.STRING },
              source_type: { type: SchemaType.STRING, description: '"lab_website" | "pubmed_abstract" | "pubmed_full_text"' },
              note: { type: SchemaType.STRING, description: 'Brief note on why this might be useful' },
            },
            required: ['quote', 'source', 'source_type'],
          },
        },
        pi_name: { type: SchemaType.STRING, description: 'PI full name as found on the website' },
        pi_email: {
          type: SchemaType.STRING,
          description: 'PI email address if found, otherwise empty string',
        },
        lab_name: { type: SchemaType.STRING, description: 'Lab or research group name' },
        publications_used: {
          type: SchemaType.ARRAY,
          description: 'List of publications referenced when writing the email',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              title: { type: SchemaType.STRING },
              source: { type: SchemaType.STRING },
              year: { type: SchemaType.STRING },
            },
            required: ['title', 'source'],
          },
        },
        agent_note: {
          type: SchemaType.STRING,
          description:
            '2-3 sentences summarizing what you found and why the email is tailored to this student and lab. Shown to the student.',
        },
        research_quality: {
          type: SchemaType.STRING,
          description:
            '"good" if you found substantial research details — multiple specific papers with abstracts, clear PI info, detailed lab focus. "limited" if the website was thin — no publications page, minimal descriptions, fewer than 2 papers found, had to rely on general field knowledge.',
        },
        term_glossary: {
          type: SchemaType.ARRAY,
          description:
            'Technical or scientific terms used in the email body that this student may not know. Calibrate strictly to their experience level — for "none": explain anything beyond common knowledge (PCR, CRISPR, checkpoint inhibitor, PI3K, etc.); for "some": only highly specialized terms; for "significant": only field-specific jargon they are unlikely to have encountered. Each explanation should be 1-2 plain sentences, no jargon, as if explaining to a curious student. If no terms need explanation, return an empty array.',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              term: { type: SchemaType.STRING, description: 'The exact term as it appears in the email body' },
              explanation: { type: SchemaType.STRING, description: 'Plain-language explanation, 1-2 sentences' },
            },
            required: ['term', 'explanation'],
          },
        },
      },
      required: [
        'candidate_findings',
        'open_problems',
        'other_quotable_specifics',
        'pi_name',
        'pi_email',
        'lab_name',
        'publications_used',
        'agent_note',
        'research_quality',
        'term_glossary',
      ],
    },
  },
]

export interface ToolCallCounts {
  fetch_webpage: number
  fetch_pubmed_abstract: number
  fetch_full_paper: number
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  counts: ToolCallCounts,
  onProgress: (message: string) => void,
): Promise<{ result: string; finished: boolean; agentResult?: AgentResult }> {
  if (name === 'fetch_webpage') {
    if (counts.fetch_webpage >= 5) {
      return { result: 'Error: fetch_webpage call limit reached (5 per session)', finished: false }
    }
    counts.fetch_webpage++
    const url = input.url as string
    const reason = input.reason as string
    onProgress(`Fetching: ${reason}...`)
    try {
      const markdown = await scrapePage(url)
      return { result: markdown.slice(0, 12000), finished: false }
    } catch (e) {
      return { result: `Error fetching ${url}: ${(e as Error).message}`, finished: false }
    }
  }

  if (name === 'search_pubmed') {
    const query = input.query as string
    onProgress('Searching PubMed for recent publications...')
    try {
      const results = await searchPubMed(query, 5)
      return { result: JSON.stringify(results, null, 2), finished: false }
    } catch (e) {
      return { result: `PubMed search error: ${(e as Error).message}`, finished: false }
    }
  }

  if (name === 'fetch_pubmed_abstract') {
    if (counts.fetch_pubmed_abstract >= 2) {
      return { result: 'Error: fetch_pubmed_abstract call limit reached (2 per session)', finished: false }
    }
    counts.fetch_pubmed_abstract++
    const pmid = input.pmid as string
    onProgress('Reading publication abstract...')
    try {
      const abstract = await fetchAbstract(pmid)
      if (!abstract) return { result: 'Abstract not found', finished: false }
      return { result: JSON.stringify(abstract, null, 2), finished: false }
    } catch (e) {
      return { result: `Abstract fetch error: ${(e as Error).message}`, finished: false }
    }
  }

  if (name === 'fetch_full_paper') {
    if (counts.fetch_full_paper >= 2) {
      return { result: 'Error: fetch_full_paper call limit reached (2 per session)', finished: false }
    }
    counts.fetch_full_paper++
    const pmid = input.pmid as string
    onProgress('Checking for full paper text (discussion + future directions)...')
    try {
      const pmcid = await getPMCID(pmid)
      if (!pmcid) {
        return { result: 'Paper not available in PubMed Central — likely paywalled. Use abstract only.', finished: false }
      }
      onProgress('Reading full paper from PubMed Central...')
      const pmcUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcid}/`
      const markdown = await scrapePage(pmcUrl)
      const keyContent = extractKeySection(markdown)
      return { result: `Full paper content (PMC${pmcid}) — Discussion/Future Directions:\n\n${keyContent}`, finished: false }
    } catch (e) {
      return { result: `Full paper fetch failed: ${(e as Error).message}`, finished: false }
    }
  }

  if (name === 'finish') {
    onProgress('Finalizing your research evidence...')
    const pubs: PublicationRef[] = ((input.publications_used as Array<Record<string, string>>) ?? []).map((p) => ({
      title: p.title,
      source: (p.source as 'lab_website' | 'pubmed') ?? 'lab_website',
      year: p.year,
    }))
    const toEvidenceItems = (raw: unknown): EvidenceItem[] =>
      ((raw as Array<Record<string, string>>) ?? []).map((item) => ({
        quote: item.quote,
        source: item.source,
        sourceType: (item.source_type as EvidenceItem['sourceType']) ?? 'lab_website',
        note: item.note,
      }))
    const evidence: ResearchEvidence = {
      candidateFindings: toEvidenceItems(input.candidate_findings),
      openProblems: toEvidenceItems(input.open_problems),
      otherQuotableSpecifics: toEvidenceItems(input.other_quotable_specifics),
    }
    const agentResult: AgentResult = {
      subject: '',
      body: '',
      piName: input.pi_name as string,
      piEmail: input.pi_email as string,
      labName: input.lab_name as string,
      publicationsUsed: pubs,
      evidence,
      specificHook: '',
      bridgeSentence: '',
      agentNote: input.agent_note as string,
      researchQuality: (input.research_quality as 'good' | 'limited') ?? 'good',
      termGlossary: ((input.term_glossary as Array<{ term: string; explanation: string }>) ?? []),
    }
    return { result: 'Done', finished: true, agentResult }
  }

  return { result: `Unknown tool: ${name}`, finished: false }
}
