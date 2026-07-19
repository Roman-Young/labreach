'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'

const NAV = [
  { href: '/', label: 'Write' },
  { href: '/digest', label: 'Screen labs' },
]

export default function SiteHeader() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="bg-grad w-4 h-4 rounded-[5px] shadow-sm transition-transform group-hover:rotate-45" />
          <span className="text-[17px] tracking-tight text-ink">
            <span className="font-medium">Lab</span>
            <span className="font-extrabold">Reach</span>
          </span>
        </Link>
        <nav className="flex items-center gap-5 sm:gap-6">
          {NAV.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm transition-colors ${
                  active
                    ? 'text-ink font-semibold'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}
