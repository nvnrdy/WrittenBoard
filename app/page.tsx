import LandingPage from '@/components/landing/LandingPage'

export default function HomePage() {
  return (
    <LandingPage
      liveId={process.env.NEXT_PUBLIC_YOUTUBE_LIVE_ID}
      youtubeChannelUrl={process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_URL}
    />
  )
}
