import { describe, it, expect } from 'vitest'
import { selectNext } from '../lib/broadcast/scheduler'

describe('scheduler', () => {
  it('returns null when empty', () => {
    expect(selectNext([])).toBeNull()
  })

  it('picks oldest overall among per-user candidates', () => {
    const items = [
      { id: '2', user_id: 'u2', type: 'text', created_at: new Date(Date.now() - 1000).toISOString() },
      { id: '1', user_id: 'u1', type: 'text', created_at: new Date(Date.now() - 2000).toISOString() },
    ]
    expect(selectNext(items)?.id).toBe('1')
  })

  it('avoids the same user when another candidate exists', () => {
    const items = [
      { id: 'a', user_id: 'u1', type: 'text', created_at: new Date('2024-01-01').toISOString() },
      { id: 'b', user_id: 'u1', type: 'text', created_at: new Date('2024-01-02').toISOString() },
      { id: 'c', user_id: 'u2', type: 'image', created_at: new Date('2024-01-01T00:00:01').toISOString() },
    ]
    const next = selectNext(items, { avoidSameUserStreak: 1, lastUserId: 'u1' })
    expect(next?.id).toBe('c')
  })

  it('prefers a different media type when available', () => {
    const items = [
      { id: 't', user_id: 'u1', type: 'text', created_at: new Date('2024-01-01').toISOString() },
      { id: 'i', user_id: 'u2', type: 'image', created_at: new Date('2024-01-02').toISOString() },
    ]
    expect(selectNext(items, { lastType: 'text' })?.id).toBe('i')
  })
})
