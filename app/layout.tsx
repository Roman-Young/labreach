import type { Metadata } from 'next'
import './globals.css'
import { ThemeToggle } from './theme-toggle'
import { AuthSessionProvider } from './session-provider'
import { AccountButton } from './account-button'
import { authConfigured } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'LabReach — Cold Email Agent for Research Lab Outreach',
  description:
    'Draft personalized cold emails to research lab PIs. Built for students with no experience looking to get their first lab position.',
}

// Runs BEFORE first paint (blocking, in <head>) to set the theme class with no flash-of-wrong-theme:
// an explicit saved choice wins; absent that, follow the OS setting. Kept as a tiny inline string.
const themeScript = `(function(){try{var t=localStorage.getItem('labreach_theme');if(t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: the script above mutates <html>'s class before React hydrates, so the
  // server ("h-full") and client ("h-full dark") className legitimately differ on this element only.
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <AuthSessionProvider>
          {children}
          <ThemeToggle />
          <AccountButton authConfigured={authConfigured} />
        </AuthSessionProvider>
      </body>
    </html>
  )
}
