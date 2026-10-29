export interface QueueItem {
  id: string
  user_id: string
  type: string
  created_at: string
  last_played_by_user?: string
  last_played_type?: string
}

/**
 * Fair queue selection: one candidate per user (their oldest item), then pick the
 * oldest candidate. Prefer a different media type from the last played item when
 * avoidSameUserStreak is set and another user is available.
 */
export function selectNext(items: QueueItem[], opts?: { avoidSameUserStreak?: number; lastUserId?: string; lastType?: string }): QueueItem | null {
  if (items.length === 0) return null
  const byUser = new Map<string, QueueItem[]>()
  for (const item of items) {
    const arr = byUser.get(item.user_id) || []
    arr.push(item)
    byUser.set(item.user_id, arr)
  }
  let candidates = Array.from(byUser.values()).map(arr =>
    arr.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
  )
  candidates.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const lastUser = opts?.lastUserId
  const streak = opts?.avoidSameUserStreak ?? 1
  if (lastUser && streak > 0 && candidates.length > 1) {
    const without = candidates.filter(c => c.user_id !== lastUser)
    if (without.length) candidates = without.concat(candidates.filter(c => c.user_id === lastUser))
  }

  const lastType = opts?.lastType
  if (lastType && candidates.length > 1) {
    const differentType = candidates.find(c => c.type !== lastType)
    if (differentType) return differentType
  }
  return candidates[0]
}
