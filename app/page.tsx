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

// Every student fills the same three buckets — courses, hands-on experience, projects.
// Only the framing shifts with experience level. A student with no lab time is not
// missing a field; they have coursework and projects, and the email will connect from
// those and claim nothing more.
const EXPERIENCE_COPY: Record<ExperienceLevel, {
  coursesHint: string; coursesPlaceholder: string
  experienceHint: string; experiencePlaceholder: string
  projectsHint: string; projectsPlaceholder: string
}> = {
  none: {
    coursesHint: "Science and math classes you've taken. These are real, earned material the email can connect from.",
    coursesPlaceholder: 'e.g. AP Biology, General Chemistry, Calculus, Intro to Neuroscience...',
    experienceHint: "Any hands-on lab work, even from a class lab section. Leave it blank if you haven't worked in a lab — that's expected, and the email will never pretend otherwise.",
    experiencePlaceholder: 'e.g. microscopy and gel electrophoresis in my BILD 3 lab section — or leave blank',
    projectsHint: "Anything you've built or run on your own — code, a science fair project, a club initiative.",
    projectsPlaceholder: 'e.g. wrote a Python script to scrape and plot local air-quality data',
  },
  some: {
    coursesHint: 'Science and math classes you\'ve taken, especially ones relevant to the labs you\'re targeting.',
    coursesPlaceholder: 'e.g. Intro Immunology, Biochemistry, Statistics for Biology, Organic Chemistry...',
    experienceHint: 'Techniques you have actually run, and time you have spent in a lab. Name the type of work — your resume carries the details.',
    experiencePlaceholder: "e.g. one semester in a microbiology lab running PCR and prepping samples",
    projectsHint: "Personal or side projects — anything you built or investigated outside of class.",
    projectsPlaceholder: 'e.g. built a small variant-calling script in Python; ran a data analysis for my club',
  },
  significant: {
    coursesHint: 'Upper-division or graduate coursework relevant to the labs you\'re targeting.',
    coursesPlaceholder: 'e.g. Advanced Immunology, Genomics, Molecular Biology of the Cell...',
    experienceHint: 'Labs you have worked in and techniques you have actually run. Name the type of work — your resume carries the details.',
    experiencePlaceholder: 'e.g. 2 years in an immunology lab; flow cytometry, mouse dissections, cell culture',
    projectsHint: 'Independent projects, pipelines, or work you drove yourself.',
    projectsPlaceholder: 'e.g. built a variant-calling pipeline; presented an abstract at a 2025 conference',
  },
}

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
  const [courses, setCourses] = useState('')
  const [experience, setExperience] = useState('')
  const [projects, setProjects] = useState('')
  const [whyResearch, setWhyResearch] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [otherInterest, setOtherInterest] = useState('')
  const [hoursPerWeek, setHoursPerWeek] = useState('')
  const [startDate, setStartDate] = useState('')
  const [duration, setDuration] = useState('')

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
      setCourses(profile.courses ?? '')
      setExperience(profile.experience ?? '')
      setProjects(profile.projects ?? '')
      setWhyResearch(profile.whyResearch ?? '')
      setInterests(profile.interests ?? [])
      setOtherInterest(profile.otherInterest ?? '')
      setHoursPerWeek(profile.hoursPerWeek ?? '')
      setStartDate(profile.startDate ?? '')
      setDuration(profile.duration ?? '')
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
    const profile: StudentProfile = { name, school, year, major: major.trim(), experienceLevel, courses, experience, projects, whyResearch, interests, otherInterest, hoursPerWeek: hoursPerWeek.trim(), startDate: startDate.trim(), duration: duration.trim() }
    saveProfile(profile)
    const request = { profile, labUrl }
    sessionStorage.setItem('labreach_request', JSON.stringify(request))
    setIsSubmitting(true)
    router.push('/draft')
  }

  // The writing sample and its 20-word gate are gone: the `voice` axis it fed passed
  // 100% of both repliers and non-repliers (evals/RESULTS.md), so it measured nothing.
  // The three experience buckets are what the writer mines for an earned connection.
  const step1Valid = name.trim() && school.trim() && whyResearch.trim() && interests.length > 0

  // Same three buckets at every level — only the framing changes. A student with no lab
  // experience has coursework and projects, and that is a complete profile, not a gap.
  const copy = EXPERIENCE_COPY[experienceLevel]

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
            </div>
          </div>

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
            <div className="border-t border-slate-700 pt-5">
              <p className="text-sm font-semibold text-slate-300 mb-1">Your background</p>
              <p className="text-xs text-slate-500 mb-3">
                The email builds its connection to a lab out of something you have actually done. Be concrete and be honest —
                anything you leave blank simply won&apos;t be claimed.
              </p>
              <div className="space-y-5">
                <Field label="Coursework" hint={copy.coursesHint}>
                  <textarea value={courses} onChange={(e) => setCourses(e.target.value)} placeholder={copy.coursesPlaceholder} rows={3} className={inputClass} />
                </Field>
                <Field label="Hands-on lab experience" hint={copy.experienceHint}>
                  <textarea value={experience} onChange={(e) => setExperience(e.target.value)} placeholder={copy.experiencePlaceholder} rows={experienceLevel === 'none' ? 2 : 4} className={inputClass} />
                </Field>
                <Field label="Projects" hint={copy.projectsHint}>
                  <textarea value={projects} onChange={(e) => setProjects(e.target.value)} placeholder={copy.projectsPlaceholder} rows={3} className={inputClass} />
                </Field>
              </div>
            </div>
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
              <p className="text-sm font-semibold text-slate-300 mb-1">Availability</p>
              <p className="text-xs text-slate-500 mb-3">Optional, but PIs ask for this directly — stating it signals the training they invest will pay off. If you fill these in, the email says so in the ask.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Hours / week">
                  <input type="text" value={hoursPerWeek} onChange={(e) => setHoursPerWeek(e.target.value)} placeholder="e.g. 10–12" className={inputClass} />
                </Field>
                <Field label="Can start">
                  <input type="text" value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="e.g. this fall" className={inputClass} />
                </Field>
                <Field label="For how long">
                  <input type="text" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 2+ semesters" className={inputClass} />
                </Field>
              </div>
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
              <p className="text-xs text-slate-500 mt-2">
                Not sure which labs? <button type="button" onClick={() => router.push('/digest')} className="text-teal-400 hover:text-teal-300">Screen several at once →</button>
              </p>
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
