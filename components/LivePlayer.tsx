'use client'
import { useState } from 'react'

export function LivePlayer({ youtubeId }: { youtubeId?: string }) {
  const [failed, setFailed] = useState(false)
  const validId = youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId) ? youtubeId : null

  if (!validId) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center rounded-[20px] border bg-zinc-900 p-8 text-center text-zinc-100">
        <div className="mb-4 h-12 w-12 rounded-full bg-white/10" />
        <h3 className="font-display text-xl">Player not configured</h3>
        <p className="mt-2 max-w-sm text-sm text-zinc-400">
          Set NEXT_PUBLIC_YOUTUBE_LIVE_ID to show a YouTube embed. That setting only configures the viewer; it does not start a livestream.
        </p>
      </div>
    )
  }

  return (
    <div className="relative w-full overflow-hidden rounded-[20px] border bg-black">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-zinc-800 px-3 py-1 text-xs font-bold text-white">
        PLAYER
      </div>
      {!failed ? (
        <iframe
          className="aspect-video w-full"
          src={`https://www.youtube-nocookie.com/embed/${validId}?autoplay=0&modestbranding=1&rel=0`}
          title="WrittenBoard player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex aspect-video items-center justify-center text-white">Stream unavailable</div>
      )}
    </div>
  )
}
