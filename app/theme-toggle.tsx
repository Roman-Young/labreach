'use client'

import { useEffect, useState } from 'react'

// Light/dark toggle. The ACTUAL theme is applied before paint by the inline script in layout.tsx
// (reads localStorage 'labreach_theme', falls back to the OS preference) so there's no flash. This
// button only flips the <html> `.dark` class + persists the explicit choice; its icon syncs to the
// real class after mount (rendered as a placeholder until then, to avoid a hydration mismatch).
export const THEME_KEY = 'labreach_theme'

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
    setMounted(true)
  }, [])

  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
    } catch {
      /* private mode / storage blocked — the class still flips for this session */
    }
  }

  return (
    <button
      onClick={toggle}
      // Render a neutral placeholder glyph until mounted so server and first client paint match.
      aria-label={mounted ? (dark ? 'Switch to light mode' : 'Switch to dark mode') : 'Toggle theme'}
      title={mounted ? (dark ? 'Switch to light mode' : 'Switch to dark mode') : 'Toggle theme'}
      className="fixed top-3 right-3 z-50 w-9 h-9 rounded-full border border-hairline bg-surface/70 backdrop-blur text-muted hover:text-ink hover:border-accent/50 flex items-center justify-center text-[15px] transition-colors"
    >
      {mounted ? (dark ? '☀' : '☾') : '☾'}
    </button>
  )
}
