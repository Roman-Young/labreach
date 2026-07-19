'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import InterestCheckboxList from '@/components/InterestCheckboxList'
import type { StudentProfile, ExperienceLevel, StudentYear } from '@/types'

const STORAGE_KEY = 'labreach_profile'
const STEP_LABELS = ['About you', 'Target lab']

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
  'w-full px-3 py-2.5 bg-surface border border-line rounded-md text-ink placeholder:text-ink-faint text-sm focus:outline-none focus:border-pine focus:ring-1 focus:ring-pine'

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
      <label className="block text-sm font-semibold text-ink mb-1">{label}</label>
      {hint && <p className="text-[13px] text-ink-soft mb-2 leading-snug">{hint}</p>}
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
      <main className="flex-1 px-4 sm:px-6 py-16">
        <div className="w-full max-w-xl mx-auto hero-glow">
          <div className="mb-8">
            <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-[-0.02em] leading-[1.05] text-ink mb-2">
              Welcome back, {savedProfile.name?.split(' ')[0]}<span className="text-grad">.</span>
            </h1>
            <p className="text-ink-soft text-lg">Ready to draft another email?</p>
          </div>

          <div className="bg-surface rounded-xl border border-line elev p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-ink">Your saved profile</h2>
              <button
                onClick={() => { setIsReturning(false); setStep(1) }}
                className="text-sm text-pine hover:text-pine-deep font-medium transition-colors"
              >
                Edit
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div><span className="text-ink-faint">School </span><span className="text-ink">{savedProfile.school}</span></div>
              <div><span className="text-ink-faint">Experience </span><span className="text-ink capitalize">{savedProfile.experienceLevel}</span></div>
              {savedProfile.interests && savedProfile.interests.length > 0 && (
                <div>
                  <span className="text-ink-faint">Interests </span>
                  <span className="text-ink">{savedProfile.interests.slice(0, 3).join(', ')}{savedProfile.interests.length > 3 ? '...' : ''}</span>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={() => setIsReturning(false)}
            className="w-full py-3 bg-pine hover:bg-pine-deep text-on-accent font-semibold rounded-md transition-colors"
          >
            Draft another email
          </button>
        </div>
      </main>
    )
  }

  // Hide until client-side hydration resolves the step
  if (step === 0) return null

  return (
    <main className="flex-1 px-4 sm:px-6 py-14">
      <div className="w-full max-w-xl mx-auto">
        {/* Header */}
        <div className="mb-10 hero-glow">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-faint mb-3">
            Step {step} of {STEP_LABELS.length}
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-[-0.02em] leading-[1.05] text-ink">
            {STEP_LABELS[step - 1]}<span className="text-grad">.</span>
          </h1>
          {step === 1 && (
            <p className="text-ink-soft mt-4 text-lg leading-relaxed">
              One profile, saved in your browser. Every draft is built from what you write here — nothing more.
            </p>
          )}
        </div>

        {/* Step 1 — About You */}
        {step === 1 && (
          <div className="space-y-6">
            <Field label="Full name">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" className={inputClass} />
            </Field>
            <Field label="School / university">
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
            <Field label="Major / field of study" hint="Optional. If given, it's used in the email's opening line; otherwise your interests are used instead.">
              <input type="text" value={major} onChange={(e) => setMajor(e.target.value)} placeholder="e.g. Biology (specializing in Bioinformatics), undeclared" className={inputClass} />
            </Field>
            <Field label="Experience level">
              <select value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value as ExperienceLevel)} className={inputClass}>
                <option value="none">No research experience yet</option>
                <option value="some">Some experience (courses, a semester in a lab, etc.)</option>
                <option value="significant">Significant experience (multiple semesters, projects)</option>
              </select>
            </Field>
            <div className="border-t border-line pt-6">
              <h2 className="text-lg font-bold tracking-tight text-ink mb-1">Your background</h2>
              <p className="text-[13px] text-ink-soft mb-5 leading-snug">
                The email builds its connection to a lab out of something you have actually done. Be concrete and be honest —
                anything you leave blank simply won&apos;t be claimed.
              </p>
              <div className="space-y-6">
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
                <p className="text-[13px] text-warn mt-1.5">Required — the agent uses this to write a genuine motivation.</p>
              )}
            </Field>
            <Field label="Science interests" hint="Select all that apply.">
              <InterestCheckboxList value={interests} otherValue={otherInterest} onChange={setInterests} onOtherChange={setOtherInterest} />
              {interests.length === 0 && (
                <p className="text-[13px] text-warn mt-1.5">Required — select at least one.</p>
              )}
            </Field>

            <div className="border-t border-line pt-6">
              <h2 className="text-lg font-bold tracking-tight text-ink mb-1">Availability</h2>
              <p className="text-[13px] text-ink-soft mb-4 leading-snug">Optional, but PIs ask for this directly — stating it signals the training they invest will pay off. If you fill these in, the email says so in the ask.</p>
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
              className="w-full py-3 bg-pine hover:bg-pine-deep disabled:bg-line disabled:text-ink-faint disabled:cursor-not-allowed text-on-accent font-semibold rounded-md transition-colors mt-2"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 2 — Target Lab */}
        {step === 2 && (
          <div className="space-y-6">
            <Field label="Lab website URL" hint="Paste the URL of the lab you want to contact. This can be their homepage, a faculty profile, or a research group page.">
              <input
                type="url"
                value={labUrl}
                onChange={(e) => { setLabUrl(e.target.value); setUrlError('') }}
                placeholder="https://smithlab.ucsf.edu"
                className={`${inputClass} ${urlError ? 'border-alert' : ''}`}
              />
              {urlError && <p className="text-sm text-alert mt-1">{urlError}</p>}
              <p className="text-[13px] text-ink-soft mt-2">
                Not sure which labs? <button type="button" onClick={() => router.push('/digest')} className="text-pine hover:text-pine-deep font-medium">Screen several at once</button>
              </p>
            </Field>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-3 border border-line bg-surface text-ink-soft hover:border-ink-faint hover:text-ink font-semibold rounded-md transition-colors">Back</button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !labUrl.trim()}
                className="flex-[2] py-3 bg-pine hover:bg-pine-deep disabled:bg-line disabled:text-ink-faint disabled:cursor-not-allowed text-on-accent font-semibold rounded-md transition-colors"
              >
                {isSubmitting ? 'Starting...' : 'Draft my email'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
