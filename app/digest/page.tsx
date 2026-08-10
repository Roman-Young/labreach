'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StudentProfile } from '@/types'
import { useDigest, BTN, INPUT, chip, type LabDigest } from './shared'

// Page 1 — intake. Collect who they are + what they're into, RAG, then go to the lab list. The
// interest chips are the FLOOR (a no-experience student still gets labs); the resume is optional
// and sharpens the match (it's distilled to research signal server-side).

const STORAGE_KEY = 'labreach_profile' // shared with the older home form
const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Other']
const INTERESTS = [
  'Cancer & oncology',
  'Immunology & immunotherapy',
  'Microbiome & infectious disease',
  'Neuroscience & neurodegeneration',
  'Stem cells & regenerative medicine',
  'Developmental biology',
  'Genetics, genomics & epigenetics',
  'Computational biology / bioinformatics / ML',
  'Structural biology & biophysics',
  'Biochemistry & chemical biology',
  'Drug discovery & pharmacology',
  'Cardiovascular & metabolic disease',
  'Aging',
  'Synthetic biology & bioengineering',
  'Systems biology',
  'Ecology & evolution',
  'Public health / clinical informatics',
]

const inputClass = INPUT

export default function IntakePage() {
  const router = useRouter()
  const { profile, setProfile, setResults } = useDigest()

  const [name, setName] = useState(profile.name)
  const [year, setYear] = useState(profile.year)
  const [major, setMajor] = useState(profile.major)
  const [interests, setInterests] = useState<string[]>(profile.interests)
  const [resume, setResume] = useState(profile.resume)
  const [topLabs, setTopLabs] = useState(profile.topLabs || 15)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // One-time prefill from the older home profile form, if this flow has no state yet.
  useEffect(() => {
    if (profile.name || profile.interests.length || profile.resume) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const s = JSON.parse(raw) as Partial<StudentProfile>
      if (s.name) setName(s.name)
      if (s.year) setYear(s.year)
      if (s.major) setMajor(s.major)
      if (s.interests?.length) setInterests(s.interests.filter((i) => INTERESTS.includes(i)))
      const exp = [s.relevantExperience, s.relevantCourses, s.whyResearch].filter(Boolean).join('. ')
      if (exp) setResume(exp)
    } catch {
      /* ignore */
    }
  }, [profile])

  // Cap at 5: keeps the student focused AND keeps retrieval sharp — averaging many interests into
  // one query dilutes the embedding the same way a raw full resume did (see lib/rag/distill.ts).
  const MAX_INTERESTS = 5
  const toggle = (i: string) =>
    setInterests((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length >= MAX_INTERESTS ? p : [...p, i]))

  const submit = async () => {
    if (!resume.trim() && interests.length === 0) {
      setError('Pick a few interests, or paste your resume / experience — either works.')
      return
    }
    setLoading(true)
    setError('')
    setProfile({ name, year, major, interests, resume, topLabs })
    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: resume, interests, topLabs }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setResults((data.query as string) ?? resume, data.labs as LabDigest[])
      router.push('/digest/labs')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setLoading(false)
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold tracking-tight leading-tight text-[#20242B]">Research Digest</h1>
        <p className="text-sm text-[#6E7076] mt-2 max-w-xl leading-relaxed">
          Every UCSD lab, pre-researched. Tell us about you, get each lab&rsquo;s real, quote-backed work ordered by
          fit, and pick who to email — LabReach never writes it for you.
        </p>
      </header>

      <div className="border border-[#E7E0D2] bg-white/40 rounded-lg p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input className={inputClass} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={inputClass} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Year…</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <input className={inputClass} placeholder="Major" value={major} onChange={(e) => setMajor(e.target.value)} />
        </div>

        <div>
          <p className="text-sm font-medium text-[#20242B] mb-2">
            What are you interested in? <span className="text-[#8A8478] font-normal">— pick up to {MAX_INTERESTS}</span>
            {interests.length > 0 && (
              <span className={`ml-2 text-xs ${interests.length >= MAX_INTERESTS ? 'text-[#A8842C] font-medium' : 'text-[#8A8478]'}`}>
                {interests.length} of {MAX_INTERESTS}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((i) => {
              const on = interests.includes(i)
              const full = !on && interests.length >= MAX_INTERESTS
              return (
                <button key={i} onClick={() => toggle(i)} disabled={full} className={`${chip(on)} ${full ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  {i}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-[#20242B] mb-1">
            Paste your resume or experience <span className="text-[#8A8478] font-normal">— optional, sharpens the match</span>
          </p>
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            rows={5}
            placeholder="Paste your whole resume, or just describe your research experience — e.g. flow cytometry on gut immune cells, scRNA-seq in R/Seurat, a peptide-matching pipeline. We pull out the research-relevant parts automatically."
            className={`${inputClass} resize-y`}
          />
        </div>

        <div>
          <label htmlFor="topLabs" className="flex items-center justify-between text-sm font-medium text-[#20242B]">
            <span>How many labs to show?</span>
            <span className="text-[#1B3A5C] font-semibold tabular-nums">{topLabs}</span>
          </label>
          <input
            id="topLabs"
            type="range"
            min={5}
            max={30}
            step={1}
            value={topLabs}
            onChange={(e) => setTopLabs(Number(e.target.value))}
            className="mt-2 w-full accent-[#1B3A5C]"
          />
          <p className="text-xs text-[#8A8478] mt-1">Fewer keeps it focused; more casts a wider net. The most relevant always come first.</p>
        </div>

        <div className="flex items-center justify-end">
          <button onClick={submit} disabled={loading} className={`w-full sm:w-auto px-4 py-2.5 sm:py-2 text-sm ${BTN}`}>
            {loading ? 'Finding labs…' : 'Find my labs →'}
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-[#9B2C2C]">{error}</p>}
    </main>
  )
}
