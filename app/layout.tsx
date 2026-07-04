import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LabReach — Cold Email Agent for Research Lab Outreach',
  description:
    'Draft personalized cold emails to research lab PIs. Built for students with no experience looking to get their first lab position.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  )
}
