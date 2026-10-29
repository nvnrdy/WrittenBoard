import { describe, it, expect } from 'vitest'
import { detectMimeFromBuffer, parseMp4DurationSeconds, assertAllowedMedia } from '../lib/media/signatures'

describe('media signatures', () => {
  it('detects jpeg/png headers', () => {
    expect(detectMimeFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg')
    expect(detectMimeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
  })

  it('rejects oversized images', () => {
    expect(() => assertAllowedMedia('image', 'image/jpeg', 6 * 1024 * 1024)).toThrow(/5MB/)
  })

  it('reads version-0 mvhd timescale/duration', () => {
    const mvhdBody = Buffer.alloc(20)
    mvhdBody[0] = 0
    mvhdBody.writeUInt32BE(1000, 12)
    mvhdBody.writeUInt32BE(15000, 16)
    const box = Buffer.alloc(8 + mvhdBody.length)
    box.writeUInt32BE(box.length, 0)
    box.write('mvhd', 4)
    mvhdBody.copy(box, 8)
    expect(parseMp4DurationSeconds(box)).toBe(15)
  })
})
