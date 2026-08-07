'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDigest, Badge, FindingCard, type DigestFinding, type LabDigest } from '../shared'

// Page 3 — the selected lab's full research. Every finding is starrable; starred findings feed the
// email skeleton on the compose page.
export default function LabPage() {
  const router = useRouter()
  const { selectedLab, query, toggleStar, isStarred, starred, setLabFindings, hydrated } = useDigest()
  const [findings, setFindings] = useState<DigestFinding[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!hydrated) return // wait for localStorage before deciding to redirect
    if (!selectedLab) {
      router.replace('/digest/labs')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/digest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: query, labUrl: selectedLab.labUrl }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load the lab.')
        if (!cancelled) {
          const fs = (data.lab as LabDigest).findings
          setFindings(fs)
          setLabFindings(fs)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the lab.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hydrated, selectedLab, query, router])

  if (!hydrated) return <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-slate-500">Loading…</main>
  if (!selectedLab) return null
  const lab = selectedLab
  const starCount = starred.length

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 pb-28">
      <button onClick={() => router.push('/digest/labs')} className="text-sm text-slate-400 hover:text-teal-300 mb-4">
        ← all labs
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-teal-300">{lab.piName ?? lab.labName ?? 'Lab'}</h1>
          {lab.labName && lab.labName !== lab.piName && <p className="text-sm text-slate-400">{lab.labName}</p>}
          <p className="text-xs text-slate-500 mt-0.5">{lab.department}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {lab.recruiting === 'open' && <Badge tone="green">recruiting: open</Badge>}
          {lab.dataModality && (
            <Badge tone={lab.dataModality === 'wet' ? 'teal' : lab.dataModality === 'dry' ? 'amber' : 'slate'}>{lab.dataModality} lab</Badge>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs">
        <a href={lab.labUrl} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-teal-300">
          lab page ↗
        </a>
        {lab.piEmail && <span className="font-mono text-slate-400">{lab.piEmail}</span>}
      </div>

      <p className="mt-6 text-sm text-slate-400">
        Star the research that interests you — you&rsquo;ll build an email from what you pick.
      </p>

      {loading && <p className="mt-4 text-sm text-slate-500">Loading this lab&rsquo;s research…</p>}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {findings && (
        <div className="mt-4 space-y-3">
          {findings.map((f, i) => (
            <FindingCard key={i} f={f} starred={isStarred(f)} onToggleStar={() => toggleStar(f)} copyable />
          ))}
        </div>
      )}

      {/* sticky compose bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-slate-400">
            {starCount === 0 ? 'Star at least one finding to build an email' : `${starCount} finding${starCount > 1 ? 's' : ''} starred`}
          </span>
          <button
            onClick={() => router.push('/digest/compose')}
            disabled={starCount === 0}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg"
          >
            Write an email →
          </button>
        </div>
      </div>
    </main>
  )
}
