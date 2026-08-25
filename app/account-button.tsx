'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signIn, signOut } from 'next-auth/react'

// The account chrome: a "Sign in" pill (guest) or avatar + menu (signed in), fixed top-right next
// to the ThemeToggle. Renders NOTHING when auth is unconfigured (prop from the server layout — the
// feature simply doesn't exist then). Sign-in is an upgrade, never a gate: nothing in the product
// is walled behind it.
export function AccountButton({ authConfigured }: { authConfigured: boolean }) {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)

  // Close the menu on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!authConfigured) return null

  if (status !== 'authenticated') {
    return (
      <button
        onClick={() => signIn('google')}
        className="fixed top-3 right-14 z-50 h-9 px-3.5 rounded-full border border-hairline bg-surface/70 backdrop-blur text-[13px] font-medium text-muted hover:text-ink hover:border-accent/50 transition-colors"
        title="Sign in with Google to save your searches across devices"
      >
        Sign in
      </button>
    )
  }

  const user = session.user
  const initial = (user?.name ?? user?.email ?? '?').trim().charAt(0).toUpperCase()

  const deleteAccount = async () => {
    if (!window.confirm('Delete your account and all saved data (history, synced searches)? This cannot be undone.')) return
    setBusy(true)
    try {
      await fetch('/api/account', { method: 'DELETE' })
    } catch {
      /* data routes will 401 regardless once the row is gone; sign out either way */
    }
    await signOut()
  }

  return (
    <div ref={rootRef} className="fixed top-3 right-14 z-50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-full border border-hairline bg-surface/70 backdrop-blur overflow-hidden flex items-center justify-center text-[13px] font-semibold text-ink hover:border-accent/50 transition-colors"
        title={user?.email ?? 'Account'}
        aria-label="Account menu"
      >
        {user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny avatar; next/image is overkill
          <img src={user.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div className="absolute top-11 right-0 w-72 rounded-lg border border-hairline bg-paper shadow-xl p-2 text-[14px]">
          <p className="px-2.5 py-1.5 text-[13px] text-muted truncate">{user?.email}</p>
          <button
            onClick={() => {
              setOpen(false)
              router.push('/digest/history')
            }}
            className="w-full text-left px-2.5 py-2 rounded-md text-ink hover:bg-surface/70"
          >
            Search history
          </button>
          <button onClick={() => signOut()} className="w-full text-left px-2.5 py-2 rounded-md text-ink hover:bg-surface/70">
            Sign out
          </button>
          <button
            onClick={deleteAccount}
            disabled={busy}
            className="w-full text-left px-2.5 py-2 rounded-md text-danger hover:bg-surface/70 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete my data…'}
          </button>
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] leading-relaxed text-muted-2 border-t border-hairline mt-1">
            Signed-in searches and your profile text are stored to power history and sync, and usage is linked to your
            account to improve LabReach. Deleting your account removes all of it.
          </p>
        </div>
      )}
    </div>
  )
}
