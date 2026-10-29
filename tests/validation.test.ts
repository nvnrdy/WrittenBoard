import { describe, it, expect } from 'vitest'
import { nicknameSchema, textSubmissionSchema, reportSchema } from '../lib/validation'

describe('nickname', () => {
  it('rejects short', () => { expect(nicknameSchema.safeParse('ab').success).toBe(false) })
  it('accepts valid', () => { expect(nicknameSchema.safeParse('cool_user-123').success).toBe(true) })
  it('rejects reserved', () => { expect(nicknameSchema.safeParse('admin').success).toBe(false) })
})

describe('text submission', () => {
  it('rejects over 500', () => {
    expect(textSubmissionSchema.safeParse({ content: 'a'.repeat(501), type: 'text' }).success).toBe(false)
  })
  it('accepts 500', () => {
    expect(textSubmissionSchema.safeParse({ content: 'a'.repeat(500), type: 'text' }).success).toBe(true)
  })
})

describe('reports', () => {
  it('requires uuid submission id', () => {
    expect(reportSchema.safeParse({ submission_id: 'nope', reason: 'spam' }).success).toBe(false)
    expect(reportSchema.safeParse({
      submission_id: '123e4567-e89b-12d3-a456-426614174000',
      reason: 'spam',
    }).success).toBe(true)
  })
})
