import { describe, expect, it } from 'vitest'
import { nicknameSchema } from '@/lib/validation'

describe('username change validation', () => {
  it('accepts generated-style CamelCase names', () => {
    expect(nicknameSchema.safeParse('CuriousComet482').success).toBe(true)
    expect(nicknameSchema.safeParse('SilentPanda731').success).toBe(true)
  })

  it('rejects reserved, short, or invalid names', () => {
    expect(nicknameSchema.safeParse('ab').success).toBe(false)
    expect(nicknameSchema.safeParse('admin').success).toBe(false)
    expect(nicknameSchema.safeParse('bad name').success).toBe(false)
    expect(nicknameSchema.safeParse('name@mail').success).toBe(false)
  })
})
