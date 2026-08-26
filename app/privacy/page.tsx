import Link from 'next/link'
import type { Metadata } from 'next'

// Privacy policy. Plain-language and accurate to what the code actually does (guest telemetry is
// anonymous; signed-in users get their profile/résumé/history stored + a delete path). Lives at a
// stable /privacy URL so it can be the Google OAuth consent screen's required privacy-policy link.
// Not lawyer-reviewed — an honest description of data practices, appropriate for this scale.

export const metadata: Metadata = {
  title: 'Privacy — LabReach',
  description: 'What LabReach collects, why, and how to delete it.',
}

const UPDATED = 'August 26, 2026'

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12 text-ink">
      <Link href="/digest" className="text-[15px] text-accent hover:underline">
        ← LabReach
      </Link>

      <h1 className="mt-5 text-[28px] font-bold tracking-tight text-accent">Privacy</h1>
      <p className="mt-1 text-[13px] text-muted-2">Last updated {UPDATED}</p>

      <div className="mt-6 space-y-6 text-[16px] leading-relaxed text-ink-2">
        <p>
          LabReach helps students decide which research labs are worth a cold email. You can use it as a guest with no
          account. Signing in with Google is optional and only adds the ability to save your work and see your search
          history across devices. This page explains what is collected in each case, and how to remove it.
        </p>

        <section>
          <h2 className="text-[18px] font-semibold text-ink">If you use LabReach as a guest</h2>
          <ul className="mt-2 space-y-2 list-disc pl-5">
            <li>
              <span className="font-medium text-ink">In your browser only:</span> your interests, résumé/profile text,
              search results, starred findings, and email drafts are saved in your browser&rsquo;s local storage. They stay
              on your device and are not tied to any identity. Clearing your browser data removes them.
            </li>
            <li>
              <span className="font-medium text-ink">Anonymous usage analytics:</span> we record which actions happen
              (searches, opening a lab, starring, hiding, starting an email) tied to a random, per-browser session ID —
              never your name, email, résumé, or IP address. This tells us how the tool is used so we can improve it.
            </li>
            <li>
              <span className="font-medium text-ink">To run a search,</span> the interests and résumé text you submit are
              sent to our server and to Google&rsquo;s Gemini API, which distills them into a search query. This text is
              processed to return your results; as a guest it is not stored on our servers afterward.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-[18px] font-semibold text-ink">If you sign in with Google</h2>
          <ul className="mt-2 space-y-2 list-disc pl-5">
            <li>
              <span className="font-medium text-ink">From your Google account:</span> your name, email address, and
              profile picture, used to identify your account and personalize the app.
            </li>
            <li>
              <span className="font-medium text-ink">Saved to power your account:</span> your profile inputs and résumé
              text, and your search history (past searches and the labs they returned), stored on our database so your
              work syncs across devices and appears in your history. Search history is limited to your 50 most recent
              searches.
            </li>
            <li>
              <span className="font-medium text-ink">Usage linked to your account:</span> the anonymous usage analytics
              above are associated with your account so we can understand real user journeys and improve LabReach. The
              analytics records themselves still contain no name, email, or résumé text.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-[18px] font-semibold text-ink">What we don&rsquo;t do</h2>
          <ul className="mt-2 space-y-2 list-disc pl-5">
            <li>We do not sell your data or share it for advertising.</li>
            <li>We do not send emails on your behalf. You write and send every email yourself.</li>
            <li>We do not post anything to your Google account; sign-in only reads your basic profile and email.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[18px] font-semibold text-ink">Services we rely on</h2>
          <p className="mt-2">
            LabReach runs on Vercel (hosting) and Neon (database), uses Google for sign-in and the Gemini API for search,
            and drew its lab data from public sources (each lab&rsquo;s own website via Firecrawl, and PubMed, OpenAlex,
            and Europe PMC). Your personal data is stored in the Neon database and is not sold or handed to third parties
            beyond these processors.
          </p>
        </section>

        <section>
          <h2 className="text-[18px] font-semibold text-ink">Deleting your data</h2>
          <p className="mt-2">
            As a guest, clear your browser storage to remove everything local. If you are signed in, open the account menu
            (top right) and choose <span className="font-medium text-ink">Delete my data</span>. This permanently deletes
            your account and everything tied to it — profile, résumé text, search history, synced state, and the link
            between your account and the usage analytics. After deletion, any remaining analytics records are fully
            anonymous and can no longer be connected to you.
          </p>
        </section>

        <section>
          <h2 className="text-[18px] font-semibold text-ink">Contact</h2>
          <p className="mt-2">
            Questions about your data? Email{' '}
            <a href="mailto:romanyoung9981@gmail.com" className="text-accent hover:underline">
              romanyoung9981@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
