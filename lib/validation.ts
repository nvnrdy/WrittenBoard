import { z } from 'zod'

export const nicknameSchema = z.string()
  .trim()
  .min(3).max(24)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Only letters, numbers, _ . - allowed')
  .refine(s => !['admin', 'moderator', 'writtenboard', 'support', 'system'].includes(s.toLowerCase()), 'Reserved name')

export const textSubmissionSchema = z.object({
  content: z.string().trim().min(1).max(500),
  type: z.literal('text'),
})

export const reportSchema = z.object({
  submission_id: z.string().uuid(),
  reason: z.enum(['sexual', 'violence', 'hate', 'harassment', 'spam', 'doxxing', 'copyright', 'illegal', 'other']),
  details: z.string().trim().max(1000).optional(),
})

export const REPORT_REASONS = reportSchema.shape.reason.options
