export type MediaKind = 'image' | 'video'

export function detectMimeFromBuffer(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm'
  return null
}

export function assertAllowedMedia(kind: MediaKind, mime: string, size: number) {
  const max = kind === 'image' ? 5 * 1024 * 1024 : 25 * 1024 * 1024
  const allowed = kind === 'image'
    ? ['image/jpeg', 'image/png', 'image/webp']
    : ['video/mp4', 'video/webm']
  if (size <= 0 || size > max) throw Object.assign(new Error(`File exceeds the ${kind === 'image' ? '5MB' : '25MB'} limit`), { status: 400 })
  if (!allowed.includes(mime)) throw Object.assign(new Error('Unsupported media type'), { status: 400 })
}

/** Best-effort MP4 duration from the movie header box (seconds). Returns null if not found. */
export function parseMp4DurationSeconds(buf: Buffer): number | null {
  let offset = 0
  while (offset + 8 <= buf.length) {
    let size = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    if (size === 1 && offset + 16 <= buf.length) size = Number(buf.readBigUInt64BE(offset + 8))
    if (size < 8) break
    if (type === 'moov' || type === 'trak' || type === 'mdia') {
      const nested = parseMp4DurationSeconds(buf.subarray(offset + 8, offset + size))
      if (nested != null) return nested
    }
    if (type === 'mvhd') {
      const version = buf[offset + 8]
      if (version === 0 && offset + 28 <= buf.length) {
        const timescale = buf.readUInt32BE(offset + 20)
        const duration = buf.readUInt32BE(offset + 24)
        if (timescale > 0) return duration / timescale
      }
      if (version === 1 && offset + 44 <= buf.length) {
        const timescale = buf.readUInt32BE(offset + 28)
        const duration = Number(buf.readBigUInt64BE(offset + 32))
        if (timescale > 0) return duration / timescale
      }
    }
    offset += size
  }
  return null
}
