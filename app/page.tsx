'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import InterestCheckboxList from '@/components/InterestCheckboxList'
import type { StudentProfile, ExperienceLevel, StudentYear } from '@/types'

const STORAGE_KEY = 'labreach_profile'
const STEP_LABELS = ['About You', 'Target Lab']

function loadProfile(): Partial<StudentProfile> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveProfile(profile: StudentProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
}

const inputClass =
  'w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-2">{hint}</p>}
      {children}
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [savedProfile, setSavedProfile] = useState<Partial<StudentProfile> | null>(null)
  const [isReturning, setIsReturning] = useState(false)

  const [name, setName] = useState('')
  const [school, setSchool] = useState('')
  const [year, setYear] = useState<StudentYear>('freshman')
  const [major, setMajor] = useState('')
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('none')
  const [relevantCourses, setRelevantCourses] = useState('')
  const [relevantExperience, setRelevantExperience] = useState('')
  const [whyResearch, setWhyResearch] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [otherInterest, setOtherInterest] = useState('')
  const [writingSample, setWritingSample] = useState('')

  const [labUrl, setLabUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const profile = loadProfile()
    if (profile?.name) {
      setSavedProfile(profile)
      setIsReturning(true)
      setName(profile.name ?? '')
      setSchool(profile.school ?? '')
      setYear(profile.year ?? 'freshman')
      setMajor(profile.major ?? '')
      setExperienceLevel(profile.experienceLevel ?? 'none')
      setRelevantCourses(profile.relevantCourses ?? '')
      setRelevantExperience(profile.relevantExperience ?? '')
      setWhyResearch(profile.whyResearch ?? '')
      setInterests(profile.interests ?? [])
      setOtherInterest(profile.otherInterest ?? '')
      setWritingSample(profile.writingSample ?? '')
      setStep(2)
    } else {
      setStep(1)
    }
  }, [])

  function validateUrl(url: string): boolean {
    try {
      const u = new URL(url)
      if (u.hostname.includes('linkedin.com')) {
        setUrlError("LinkedIn URLs aren't supported. Try the professor's lab page or university profile.")
        return false
      }
      setUrlError('')
      return true
    } catch {
      setUrlError('Please enter a valid URL (starting with https://)')
      return false
    }
  }

  async function handleSubmit() {
    if (!validateUrl(labUrl)) return
    const profile: StudentProfile = { name, school, year, major: major.trim(), experienceLevel, relevantCourses, relevantExperience, whyResearch, interests, otherInterest, writingSample }
    saveProfile(profile)
    const request = { profile, labUrl }
    sessionStorage.setItem('labreach_request', JSON.stringify(request))
    setIsSubmitting(true)
    router.push('/draft')
  }

  const writingSampleWordCount = writingSample.trim().split(/\s+/).filter(Boolean).length
  const writingSampleValid = writingSampleWordCount >= 20
  const step1Valid = name.trim() && school.trim() && writingSampleValid && whyResearch.trim() && interests.length > 0

  // Returning user shortcut screen
  if (isReturning && savedProfile?.name && step === 2) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg">
          <div className="mb-10 text-center">
            <div className="text-teal-400 font-mono text-sm tracking-widest mb-4">LABREACH</div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Welcome back, {savedProfile.name?.split(' ')[0]}.
            </h1>
            <p className="text-slate-400">Ready to draft another email?</p>
          </div>

          <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-300">Your saved profile</h2>
              <button
                onClick={() => { setIsReturning(false); setStep(1) }}
                className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
              >
                Edit
              </button>
            </div>
            <div className="space-y-2 text-sm text-slate-400">
              <div><span className="text-slate-500">School: </span><span className="text-slate-300">{savedProfile.school}</span></div>
              <div><span className="text-slate-500">Experience: </span><span className="text-slate-300 capitalize">{savedProfile.experienceLevel}</span></div>
              {savedProfile.interests && savedProfile.interests.length > 0 && (
                <div>
                  <span className="text-slate-500">Interests: </span>
                  <span className="text-slate-300">{savedProfile.interests.slice(0, 3).join(', ')}{savedProfile.interests.length > 3 ? '...' : ''}</span>
                </div>
              )}
              {savedProfile.writingSample && (
                <div><span className="text-slate-500">Writing sample: </span><span className="text-slate-300">Saved</span></div>
              )}
            </div>
          </div>

          {!savedProfile.writingSample && (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 mb-4">
              <p className="text-sm text-amber-300 font-medium mb-1">Writing sample missing</p>
              <p className="text-xs text-amber-400/80">Edit your profile to add one — it&apos;s how the agent writes in your voice.</p>
            </div>
          )}

          <button
            onClick={() => setIsReturning(false)}
            className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded-xl transition-colors"
          >
            Draft Another Email →
          </button>
        </div>
      </main>
    )
  }

  // Hide until client-side hydration resolves the step
  if (step === 0) return null

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-teal-400 font-mono text-sm tracking-widest mb-4">LABREACH</div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-5">
            {STEP_LABELS.map((label, i) => {
              const n = (i + 1) as 1 | 2
              return (
                <div key={n} className="flex items-center gap-2">
                  <div
                    className={`flex items-center gap-1.5 ${n < step ? 'cursor-pointer' : ''}`}
                    onClick={() => { if (n < step) setStep(n) }}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${n === step ? 'bg-teal-500 text-white' : n < step ? 'bg-teal-800 text-teal-300' : 'bg-slate-800 text-slate-600'}`}>
                      {n < step ? '✓' : n}
                    </div>
                    <span className={`text-xs hidden sm:block ${n === step ? 'text-white' : 'text-slate-600'}`}>{label}</span>
                  </div>
                  {i < STEP_LABELS.length - 1 && (
                    <div className={`w-8 h-px ${n < step ? 'bg-teal-800' : 'bg-slate-700'}`} />
                  )}
                </div>
              )
            })}
          </div>

          <h2 className="text-2xl font-bold text-white">{STEP_LABELS[step - 1]}</h2>
        </div>

        {/* Step 1 — About You */}
        {step === 1 && (
          <div className="space-y-5">
            <Field label="Full Name">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" className={inputClass} />
            </Field>
            <Field label="School / University">
              <input type="text" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="e.g. UC San Diego, MIT, Jefferson High School" className={inputClass} />
            </Field>
            <Field label="Year">
              <select value={year} onChange={(e) => setYear(e.target.value as StudentYear)} className={inputClass}>
                <option value="high_school">High School</option>
                <option value="freshman">Freshman</option>
                <option value="sophomore">Sophomore</option>
                <option value="junior">Junior</option>
                <option value="senior">Senior</option>
                <option value="graduate">Graduate Student</option>
              </select>
            </Field>
            <Field label="Major / Field of Study" hint="Optional. If given, it's used in the email's opening line; otherwise your interests are used instead.">
              <input type="text" value={major} onChange={(e) => setMajor(e.target.value)} placeholder="e.g. Biology (specializing in Bioinformatics), undeclared" className={inputClass} />
            </Field>
            <Field label="Experience Level">
              <select value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value as ExperienceLevel)} className={inputClass}>
                <option value="none">No research experience yet</option>
                <option value="some">Some experience (courses, a semester in a lab, etc.)</option>
                <option value="significant">Significant experience (multiple semesters, projects)</option>
              </select>
            </Field>
            {(experienceLevel === 'none' || experienceLevel === 'some') && (
              <Field
                label="Relevant Courses"
                hint="List science or math classes you've taken. These go in your transcript attachment and help the agent make connections."
              >
                <textarea
                  value={relevantCourses}
                  onChange={(e) => setRelevantCourses(e.target.value)}
                  placeholder="e.g. AP Biology, AP Chemistry, Calculus, Intro to Neuroscience, Organic Chemistry..."
                  rows={3}
                  className={inputClass}
                />
              </Field>
            )}
            {experienceLevel === 'none' && (
              <Field label="Other Skills" hint="Programming, lab techniques from class, volunteering, clubs — anything science-adjacent.">
                <textarea value={relevantExperience} onChange={(e) => setRelevantExperience(e.target.value)} placeholder="e.g. Python basics, hospital volunteer, science olympiad, microscopy in class..." rows={3} className={inputClass} />
              </Field>
            )}
            {experienceLevel === 'some' && (
              <Field label="Research & Work Experience" hint="Describe your lab experience, internships, or relevant jobs. This goes in your resume attachment.">
                <textarea value={relevantExperience} onChange={(e) => setRelevantExperience(e.target.value)} placeholder="e.g. One semester in Dr. Smith's lab doing PCR and cell culture, hospital volunteer for 6 months..." rows={4} className={inputClass} />
              </Field>
            )}
            {experienceLevel === 'significant' && (
              <Field label="Research Experience & Skills" hint="Your most relevant projects, techniques, and accomplishments. This goes in your resume.">
                <textarea value={relevantExperience} onChange={(e) => setRelevantExperience(e.target.value)} placeholder="e.g. 2 years in immunology lab, proficient in flow cytometry, CRISPR, published abstract in 2024..." rows={4} className={inputClass} />
              </Field>
            )}
            <Field label="Why do you want to do research?" hint="In 1-2 sentences. Be honest — the agent uses this to make the email feel genuine.">
              <textarea value={whyResearch} onChange={(e) => setWhyResearch(e.target.value)} placeholder="e.g. I want to understand disease at a mechanistic level, not just learn about it from textbooks." rows={3} className={inputClass} />
              {!whyResearch.trim() && (
                <p className="text-xs text-amber-400 mt-1.5">Required — the agent uses this to write a genuine motivation.</p>
              )}
            </Field>
            <Field label="Science Interests" hint="Select all that apply.">
              <InterestCheckboxList value={interests} otherValue={otherInterest} onChange={setInterests} onOtherChange={setOtherInterest} />
              {interests.length === 0 && (
                <p className="text-xs text-amber-400 mt-1.5">Required — select at least one.</p>
              )}
            </Field>

            <div className="border-t border-slate-700 pt-5">
              <Field
                label="Your Writing Sample"
                hint="Paste a few sentences or a short paragraph written by you — an email, a text message, anything that sounds like you. The agent uses this to write in your voice, not in AI voice."
              >
                <textarea
                  value={writingSample}
                  onChange={(e) => setWritingSample(e.target.value)}
                  placeholder="e.g. Hey Dr. Smith, I saw your talk last week and the part about X really stuck with me. I've been thinking about it ever since..."
                  rows={5}
                  className={inputClass}
                />
                {!writingSample.trim() && (
                  <p className="text-xs text-amber-400 mt-1.5">Required — this is how the agent learns your voice.</p>
                )}
                {writingSample.trim() && !writingSampleValid && (
                  <p className="text-xs text-amber-400 mt-1.5">{writingSampleWordCount} words — needs at least 20 so the agent has enough to match your voice.</p>
                )}
              </Field>
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!step1Valid}
              className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors mt-2"
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 2 — Target Lab */}
        {step === 2 && (
          <div className="space-y-5">
            <Field label="Lab Website URL" hint="Paste the URL of the lab you want to contact. This can be their homepage, a faculty profile, or a research group page.">
              <input
                type="url"
                value={labUrl}
                onChange={(e) => { setLabUrl(e.target.value); setUrlError('') }}
                placeholder="https://smithlab.ucsf.edu"
                className={`${inputClass} ${urlError ? 'border-red-500' : ''}`}
              />
              {urlError && <p className="text-sm text-red-400 mt-1">{urlError}</p>}
            </Field>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-3 border border-slate-600 text-slate-300 hover:border-slate-400 hover:text-white font-semibold rounded-xl transition-colors">← Back</button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !labUrl.trim()}
                className="flex-[2] py-3 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
              >
                {isSubmitting ? 'Starting...' : 'Draft My Email →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
