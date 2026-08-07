import { redirect } from 'next/navigation'

// The product is the research digest (app/digest). The legacy email-writer intake that used to live
// here — collect a profile + one lab URL, then write the email at /draft — is retired ("batch the
// research, never the authorship"). The front door now sends everyone straight into the digest flow.
export default function Home() {
  redirect('/digest')
}
