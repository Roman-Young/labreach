// Enumerate UCSD PIs from faculty directories into a lab list for ingestion.
// Scrapes each directory (Firecrawl renders the JS), then uses Gemini to extract
// principal investigators (excluding adjunct/emeritus/lecturer/staff) uniformly
// across the 7 different site layouts. Writes data/ucsd-labs.json.
// Run:  npx tsx scripts/enumerate.ts

process.loadEnvFile('.env.local')

const DIRECTORIES = [
  { department: 'Biomedical Informatics', school: 'Medicine', url: 'https://dbmi.ucsd.edu/people/faculty.html' },
  { department: 'Bioinformatics', school: 'Bioinformatics', url: 'https://bioinformatics.ucsd.edu/faculty' },
  { department: 'Cell & Developmental Biology', school: 'Biological Sciences', url: 'https://biology.ucsd.edu/research/academic-departments/cdb/faculty.html' },
  { department: 'Neurobiology', school: 'Biological Sciences', url: 'https://biology.ucsd.edu/research/academic-departments/nb/faculty.html' },
  { department: 'Molecular Biology', school: 'Biological Sciences', url: 'https://biology.ucsd.edu/research/academic-departments/mb/faculty.html' },
  { department: 'Ecology, Behavior & Evolution', school: 'Biological Sciences', url: 'https://biology.ucsd.edu/research/academic-departments/ebe/faculty.html' },
  { department: 'Bioengineering', school: 'Bioengineering', url: 'https://be.ucsd.edu/faculty' },
  { department: 'Chemistry & Biochemistry', school: 'Physical Sciences', url: 'https://chemistry.ucsd.edu/faculty/index.shtml' },
  { department: 'Cellular & Molecular Medicine', school: 'Medicine', url: 'https://cmm.ucsd.edu/faculty/index.html' },
  { department: 'Pharmacology', school: 'Medicine', url: 'https://pharmacology.ucsd.edu/faculty/department-faculty.html' },
  { department: 'Pathology', school: 'Medicine', url: 'https://pathology.ucsd.edu/research/labs/index.html' },
  { department: 'Hematology-Oncology', school: 'Medicine', url: 'https://hem-onc.ucsd.edu/about/faculty.html' },
  { department: 'Regenerative Medicine', school: 'Medicine', url: 'https://regenmed.ucsd.edu/about/faculty.html' },
]

type Lab = { name: string; title: string; url: string | null; department: string; school: string }

async function main() {
  const fs = await import('node:fs')
  const { scrapePage } = await import('../lib/scraper')
  const { GoogleGenerativeAI, SchemaType } = await import('@google/generative-ai')

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY as string)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: 'Full name of the PI' },
            title: { type: SchemaType.STRING, description: 'Their title, e.g. "Associate Professor"' },
            url: { type: SchemaType.STRING, description: 'The href to their profile or lab page exactly as in the markdown (relative or absolute); empty string if none.' },
          },
          required: ['name', 'title'],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  })

  const all: Lab[] = []
  for (const dir of DIRECTORIES) {
    try {
      const md = await scrapePage(dir.url)
      const prompt = `This is the ${dir.department} faculty directory. Extract every PRINCIPAL INVESTIGATOR — a professor who runs their own lab (Assistant, Associate, Full, or Distinguished Professor). EXCLUDE: adjunct, emeritus, visiting, teaching professors, lecturers, project scientists/researchers without a professorship, postdocs, and staff. For each, give the name, the title, and the href to their profile/lab page exactly as it appears in the markdown links (empty string if there is no link).\n\nMarkdown:\n${md.slice(0, 40000)}`
      const res = await model.generateContent(prompt)
      const list = JSON.parse(res.response.text()) as Array<{ name: string; title: string; url?: string }>
      let withUrl = 0
      for (const p of list) {
        let url: string | null = null
        if (p.url && p.url.trim()) {
          try { url = new URL(p.url.trim(), dir.url).href; withUrl++ } catch { url = null }
        }
        all.push({ name: p.name, title: p.title, url, department: dir.department, school: dir.school })
      }
      console.log(`  ${dir.department.padEnd(32)} ${String(list.length).padStart(3)} PIs  (${withUrl} with a URL)`)
    } catch (e) {
      console.log(`  ${dir.department.padEnd(32)}  FAILED — ${(e as Error).message}`)
    }
  }

  // Dedupe by lowercased name; when a PI is cross-listed across departments, keep
  // the entry that has a URL (the Bioinformatics program re-lists home-dept faculty).
  const byName = new Map<string, Lab>()
  for (const l of all) {
    const key = l.name.toLowerCase().trim()
    const existing = byName.get(key)
    if (!existing) byName.set(key, l)
    else if (!existing.url && l.url) byName.set(key, l)
  }
  const deduped = [...byName.values()]

  fs.mkdirSync('data', { recursive: true })
  fs.writeFileSync('data/ucsd-labs.json', JSON.stringify(deduped, null, 2))
  const withUrl = deduped.filter((l) => l.url).length
  console.log(`\nTotal: ${deduped.length} unique PIs (${withUrl} with a URL, ${deduped.length - withUrl} name-only) -> data/ucsd-labs.json`)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })

export {}
