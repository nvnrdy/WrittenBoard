import { Header } from '@/components/Header'
import { currentUser, isModerator } from '@/lib/firebase/server-auth'

export const dynamic = 'force-dynamic'

export default async function How() {
  const user = await currentUser()
  return (
    <div>
      <Header user={user ? { id: user.uid, email: user.email } : null} isStaff={user ? isModerator(user) : false} />
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-bold">How WrittenBoard works</h1>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-zinc-600">
          <li>Sign in and choose a public nickname.</li>
          <li>Submit text, an image, or a short video. Uploads use short-lived server-signed URLs.</li>
          <li>Automated text checks may run; all content still needs human review before approval.</li>
          <li>Moderators preview media with short-lived signed URLs, verify duration, then approve into the queue.</li>
          <li>A broadcast worker drains the queue. Dry-run mode verifies the workflow without claiming a YouTube stream. RTMP mode requires FFmpeg and a stream key.</li>
        </ol>
      </div>
    </div>
  )
}
