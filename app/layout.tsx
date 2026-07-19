import type { Metadata } from 'next'
import { Schibsted_Grotesk, Bricolage_Grotesque, IBM_Plex_Mono } from 'next/font/google'
import SiteHeader from '@/components/SiteHeader'
import './globals.css'

const grotesk = Schibsted_Grotesk({
  subsets: ['latin'],
  variable: '--font-grotesk',
})

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-bricolage',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
})

export const metadata: Metadata = {
  title: 'LabReach — Cold Email Agent for Research Lab Outreach',
  description:
    'Draft personalized cold emails to research lab PIs. Built for students with no experience looking to get their first lab position.',
}

// Set the saved theme before first paint so there's no flash of the wrong theme.
const themeInit = `(function(){try{var q=new URLSearchParams(location.search).get('theme');var t=(q==='light'||q==='dark')?q:localStorage.getItem('labreach_theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);if(q)localStorage.setItem('labreach_theme',t);}}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`h-full ${grotesk.variable} ${bricolage.variable} ${plexMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  )
}
