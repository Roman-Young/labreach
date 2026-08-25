'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signIn } from 'next-auth/react'
import { useDigest, LINK, BTN, type LabDigest } from '../shared'

// Search history (signed-in only). Each entry restores a past search wholesale — the digest that
// came back that day, not a fresh (billed) re-run. The list endpoint returns summaries; the full
// labs payload is fetched only for the entry being restored.

interface HistoryEntry {
  id: number
  createdAt: string
  query: string
  interests: string[]
  labCount: number
}

export default function HistoryPage() {
  const router = useRouter()
  const { setResults, hydrated } = useDigest()
  const { status: sessionStatus } = useSession()
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState<number | null>(null)

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/history')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load history.')
        if (!cancelled) setEntries(data.entries as HistoryEntry[])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load history.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionStatus])

  const restore = async (id: number) => {
    setRestoring(id)
    try {
      const res = await fetch(`/api/history?id=${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not load this search.')
      setResults(data.query as string, data.labs as LabDigest[])
      router.push('/digest/labs')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this search.')
      setRestoring(null)
    }
  }

  const remove = async (id: number) => {
    setEntries((es) => (es ? es.filter((e) => e.id !== id) : es)) // optimistic
    void fetch(`/api/history?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }

  if (!hydrated || sessionStatus === 'loading') {
    return <main className="max-w-5xl mx-auto px-4 py-10 text-sm text-muted-2">Loading…</main>
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <button onClick={() => router.push('/digest')} className={`text-[15px] mb-5 ${LINK}`}>
        ← new search
      </button>

      <h1 className="text-[28px] font-bold tracking-tight leading-tight text-accent">Your search history</h1>

      {sessionStatus !== 'authenticated' ? (
        <div className="mt-5 text-[15px] text-muted">
          <p>Sign in to save your searches — every search you run while signed in lands here, restorable on any device.</p>
          <button onClick={() => signIn('google')} className={`mt-4 px-4 py-2 text-[15px] ${BTN}`}>
            Sign in with Google
          </button>
        </div>
      ) : error ? (
        <p className="mt-5 text-[15px] text-danger">{error}</p>
      ) : entries === null ? (
        <p className="mt-5 text-[15px] text-muted-2">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-5 text-[15px] text-muted">No saved searches yet — run a search and it will appear here.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {entries.map((e) => (
            <div key={e.id} className="flex flex-col border border-hairline bg-surface/40 rounded-lg p-5">
              <p className="text-[13px] text-muted-2">
                {new Date(e.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ·{' '}
                {e.labCount} labs
              </p>
              {e.interests.length > 0 && (
                <p className="mt-1.5 text-[14px] text-ink-2 leading-relaxed line-clamp-2">{e.interests.join(' · ')}</p>
              )}
              <p className="mt-1 text-[13px] text-muted italic line-clamp-2">{e.query}</p>
              <div className="mt-auto pt-3 flex items-center gap-4 text-[13px]">
                <button onClick={() => remove(e.id)} className="p-2.5 -m-2.5 text-muted-2 hover:text-danger" title="Delete this entry">
                  ✕ delete
                </button>
                <button onClick={() => restore(e.id)} disabled={restoring !== null} className={`ml-auto ${LINK} disabled:opacity-50`}>
                  {restoring === e.id ? 'Restoring…' : 'Open results →'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
