import Link from 'next/link'
import { AppHeader } from '@/components/app-shell/AppHeader'
import { currentUser, isModerator } from '@/lib/firebase/server-auth'
import '@/components/app-shell/app-shell.css'

export const dynamic = 'force-dynamic'

export default async function HowItWorksPage() {
  const user = await currentUser()
  return (
    <div className="wa">
      <AppHeader signedIn={!!user} isStaff={user ? isModerator(user) : false} />
      <main className="wa-main wa-main-narrow">
        <h1 className="wa-page-title">How it works</h1>
        <p className="wa-lead">
          Watching is free. Submitting requires sign-in, a public username, and human review before anything can air.
        </p>
        <ol className="wa-list" style={{ listStyle: 'decimal', paddingLeft: 20, marginTop: 20 }}>
          <li className="wa-item" style={{ display: 'list-item' }}><b>Submit</b> — text, image, or short video within the size limits.</li>
          <li className="wa-item" style={{ display: 'list-item' }}><b>We review</b> — moderators check every submission; media stays private until approved.</li>
          <li className="wa-item" style={{ display: 'list-item' }}><b>Queue</b> — approved items may enter the broadcast queue. Order and timing are not guaranteed.</li>
          <li className="wa-item" style={{ display: 'list-item' }}><b>Live</b> — Now showing / Up next on the home page reflect the real queue when something is playing.</li>
        </ol>
        <div className="wa-row" style={{ marginTop: 20 }}>
          <Link href={user ? '/submit' : '/auth'} className="wa-btn wa-btn-primary">Submit yours</Link>
          <Link href="/guidelines" className="wa-btn">Community Guidelines</Link>
        </div>
      </main>
    </div>
  )
}
