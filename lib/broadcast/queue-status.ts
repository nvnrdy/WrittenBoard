export type QueueStatusView = {
  nowShowing: string
  upNext: string
}

const FALLBACK: QueueStatusView = {
  nowShowing: 'Nothing on air yet',
  upNext: 'The queue is open',
}

/** Honest queue summary for the public landing page — never invents content. */
export async function getPublicQueueStatus(): Promise<QueueStatusView> {
  try {
    const { db } = await import('@/lib/firebase/admin')
    const [playingSnap, queuedSnap] = await Promise.all([
      db.collection('broadcast_queue').where('status', '==', 'playing').limit(1).get(),
      db.collection('broadcast_queue').where('status', '==', 'queued').orderBy('createdAt', 'asc').limit(1).get(),
    ])

    const playing = playingSnap.docs[0]?.data()
    const next = queuedSnap.docs[0]?.data()

    const nowShowing = playing ? formatItem(playing) : 'Nothing on air yet'
    const upNext = next
      ? formatItem(next)
      : (playing ? 'Queue empty after current item' : 'The queue is open')

    return { nowShowing, upNext }
  } catch {
    return FALLBACK
  }
}

function formatItem(data: Record<string, unknown>) {
  const type = String(data.type || 'submission')
  const name = String(data.displayName || 'community')
  return `${type} from @${name}`
}
