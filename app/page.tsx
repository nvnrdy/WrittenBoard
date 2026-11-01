import LandingPage from '@/components/landing/LandingPage'
import { getPublicQueueStatus } from '@/lib/broadcast/queue-status'
import { currentUser, isModerator } from '@/lib/firebase/server-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function HomePage() {
  const [queue, user] = await Promise.all([
    getPublicQueueStatus(),
    currentUser(),
  ])
  return (
    <LandingPage
      liveId={process.env.NEXT_PUBLIC_YOUTUBE_LIVE_ID}
      youtubeChannelUrl={process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_URL}
      nowShowing={queue.nowShowing}
      upNext={queue.upNext}
      signedIn={!!user}
      isStaff={user ? isModerator(user) : false}
    />
  )
}
