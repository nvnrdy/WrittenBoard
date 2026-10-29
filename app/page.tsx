import Link from 'next/link'
import { Header } from '@/components/Header'
import { LivePlayer } from '@/components/LivePlayer'
import { Logo } from '@/components/Logo'
import { currentUser, isModerator } from '@/lib/firebase/server-auth'
import { db } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const user = await currentUser()
  const youtubeId = process.env.NEXT_PUBLIC_YOUTUBE_LIVE_ID
  return (
    <div>
      <Header user={user ? { id: user.uid, email: user.email } : null} isStaff={user ? isModerator(user) : false} />
      <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <LivePlayer youtubeId={youtubeId} />
            <div className="flex gap-2 text-xs text-zinc-500">
              <span className="rounded-full border px-2 py-1">Public viewing — no login required</span>
              {youtubeId && <span className="rounded-full border px-2 py-1">YouTube embed configured</span>}
            </div>
          </div>
          <div className="space-y-6">
            <div className="rounded-[24px] border bg-white p-6 shadow-sm md:p-8">
              <Logo size="lg" />
              <h1 className="mt-4 font-display text-3xl leading-tight">Your voice. The world&apos;s screen.</h1>
              <p className="mt-3 text-zinc-600">Watch the community. Share your voice. Only approved texts, images and short clips are eligible for broadcast.</p>
              <div className="mt-6 grid gap-3">
                <div className="flex gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-900 text-sm text-white">1</span><p className="text-sm"><b>Watch</b> without an account.</p></div>
                <div className="flex gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-900 text-sm text-white">2</span><p className="text-sm"><b>Sign in</b> and choose a unique public nickname.</p></div>
                <div className="flex gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-900 text-sm text-white">3</span><p className="text-sm"><b>Submit</b> text, image or short video for human review.</p></div>
              </div>
              <div className="mt-6 flex gap-3">
                <Link href="/submit" className="flex-1 rounded-full bg-zinc-900 py-3 text-center text-sm font-medium text-white">Submit Content</Link>
                <Link href="/how-it-works" className="flex-1 rounded-full border py-3 text-center text-sm font-medium">How it works</Link>
              </div>
              <p className="mt-3 text-[11px] text-zinc-500">No unreviewed content is broadcast. Live encoding requires a configured worker.</p>
            </div>
            <div className="rounded-[20px] border bg-white p-5">
              <h3 className="font-medium">Community status</h3>
              <QueueStatus />
            </div>
          </div>
        </div>
      </main>
      <footer className="mt-12 border-t py-8 text-sm text-zinc-500">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-4 px-4">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/guidelines">Community Guidelines</Link>
          <Link href="/copyright">Copyright</Link>
          <Link href="/contact">Contact</Link>
          <span className="ml-auto">© {new Date().getFullYear()} WrittenBoard</span>
        </div>
      </footer>
    </div>
  )
}

async function QueueStatus() {
  try {
    const [approved, pending] = await Promise.all([
      db.collection('submissions').where('status', '==', 'approved').count().get(),
      db.collection('submissions').where('status', '==', 'pending_moderation').count().get(),
    ])
    return <p className="mt-2 text-sm">{approved.data().count} approved • {pending.data().count} pending moderation</p>
  } catch {
    return <p className="mt-2 text-sm text-zinc-400">Community status temporarily unavailable.</p>
  }
}
