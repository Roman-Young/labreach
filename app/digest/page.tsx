'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StudentProfile } from '@/types'
import { useDigest, type LabDigest } from './shared'

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

const inputClass =
  'w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500'

export default function IntakePage() {
  const router = useRouter()
  const { profile, setProfile, setResults } = useDigest()

  const [name, setName] = useState(profile.name)
  const [year, setYear] = useState(profile.year)
  const [major, setMajor] = useState(profile.major)
  const [interests, setInterests] = useState<string[]>(profile.interests)
  const [resume, setResume] = useState(profile.resume)
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

  const toggle = (i: string) => setInterests((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))

  const submit = async () => {
    if (!resume.trim() && interests.length === 0) {
      setError('Pick a few interests, or paste your resume / experience — either works.')
      return
    }
    setLoading(true)
    setError('')
    setProfile({ name, year, major, interests, resume })
    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: resume, interests }),
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
        <h1 className="text-2xl font-bold text-white">Research Digest</h1>
        <p className="text-sm text-slate-400 mt-1">
          Every UCSD lab, pre-researched. Tell us about you, get each lab&rsquo;s real, quote-backed work ordered by
          fit, and pick who to email — LabReach never writes it for you.
        </p>
      </header>

      <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-4 space-y-4">
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
          <p className="text-sm font-medium text-slate-300 mb-2">What are you interested in?</p>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((i) => {
              const on = interests.includes(i)
              return (
                <button
                  key={i}
                  onClick={() => toggle(i)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    on ? 'bg-teal-500/20 text-teal-200 border-teal-500/50' : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-500'
                  }`}
                >
                  {i}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-300 mb-1">
            Paste your resume or experience <span className="text-slate-500 font-normal">— optional, sharpens the match</span>
          </p>
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            rows={5}
            placeholder="Paste your whole resume, or just describe your research experience — e.g. flow cytometry on gut immune cells, scRNA-seq in R/Seurat, a peptide-matching pipeline. We pull out the research-relevant parts automatically."
            className={`${inputClass} resize-y`}
          />
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={submit}
            disabled={loading}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg"
          >
            {loading ? 'Finding labs…' : 'Find my labs →'}
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </main>
  )
}
