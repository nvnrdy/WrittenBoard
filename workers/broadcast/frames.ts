/**
 * Turns queue items into raw yuv420p frames for the compositor.
 *
 * - Text and images are rendered once into a single still frame.
 * - Videos are decoded by a child ffmpeg into a bounded frame queue with backpressure.
 * - Dry-run uses timed placeholder sources so no ffmpeg is required.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { layoutText, normalizeText } from './text-layout'
import { redactSecrets, type WorkerConfig } from './config'

export interface FrameSource {
  /** Next frame to air, or null once the source has finished. */
  nextFrame(): Buffer | null
  /** Releases resources (kills decoders). Safe to call more than once. */
  stop(): void
  /** Set when the source ended because of an error rather than reaching its end. */
  readonly error: Error | null
}

export const BACKGROUND = '0x0b1020'
export const FONT_COPY_NAME = 'broadcast-font'

export function frameSize(cfg: Pick<WorkerConfig, 'width' | 'height'>) {
  return (cfg.width * cfg.height * 3) / 2 // yuv420p
}

/** Splits a byte stream into fixed-size frames. */
export class FrameSplitter {
  private chunks: Buffer[] = []
  private buffered = 0
  constructor(private readonly size: number) {}

  push(chunk: Buffer): Buffer[] {
    this.chunks.push(chunk)
    this.buffered += chunk.length
    const frames: Buffer[] = []
    if (this.buffered < this.size) return frames
    let all = Buffer.concat(this.chunks, this.buffered)
    while (all.length >= this.size) {
      frames.push(Buffer.from(all.subarray(0, this.size)))
      all = all.subarray(this.size)
    }
    this.chunks = all.length ? [Buffer.from(all)] : []
    this.buffered = all.length
    return frames
  }
}

/** A frame shown for a fixed number of ticks. */
export class StillSource implements FrameSource {
  private shown = 0
  readonly error = null
  constructor(private readonly frame: Buffer, private readonly frames: number) {}
  nextFrame() {
    if (this.shown >= this.frames) return null
    this.shown++
    return this.frame
  }
  stop() { this.shown = this.frames }
}

const LOW_WATER = 8
const HIGH_WATER = 30

/** Streams decoded video frames; repeats the last frame on a decoder underrun. */
export class VideoSource implements FrameSource {
  error: Error | null = null
  emitted = 0
  private queue: Buffer[] = []
  private last: Buffer | null = null
  private ended = false
  private paused = false

  private constructor(private readonly child: ChildProcess) {}

  static start(cfg: WorkerConfig, file: string, demuxer: string, signal: AbortSignal): Promise<VideoSource> {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-protocol_whitelist', 'file',
      '-f', demuxer, '-i', file,
      '-t', String(cfg.maxVideoSeconds),
      '-an', '-sn', '-dn',
      '-vf', `${fitFilter(cfg)},fps=${cfg.fps},format=yuv420p`,
      '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1',
    ]
    const child = spawn(cfg.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const source = new VideoSource(child)
    const splitter = new FrameSplitter(frameSize(cfg))
    let stderr = ''

    return new Promise<VideoSource>((resolve, reject) => {
      let settled = false
      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        if (err) {
          source.stop()
          reject(err)
        } else resolve(source)
      }
      const onAbort = () => settle(new Error('aborted'))
      signal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => settle(new Error('Video decoder produced no frames within 20s')), 20_000)

      child.stdout!.on('data', (chunk: Buffer) => {
        for (const frame of splitter.push(chunk)) source.queue.push(frame)
        if (source.queue.length >= HIGH_WATER && !source.paused) {
          source.paused = true
          child.stdout!.pause()
        }
        if (source.queue.length > 0) settle()
      })
      child.stderr!.on('data', (d) => { stderr = (stderr + String(d)).slice(-2000) })
      child.on('error', (err) => {
        source.error = err
        source.ended = true
        settle(err)
      })
      child.on('close', (code) => {
        source.ended = true
        if (code !== 0 && code !== null) {
          source.error = new Error(`video decoder exited ${code}: ${redactSecrets(stderr.trim().slice(-300), cfg.redact)}`)
        }
        if (source.queue.length === 0) settle(source.error || new Error('Video contained no decodable frames'))
      })
    })
  }

  nextFrame() {
    const frame = this.queue.shift()
    if (frame) {
      this.last = frame
      this.emitted++
      if (this.paused && this.queue.length <= LOW_WATER) {
        this.paused = false
        this.child.stdout?.resume()
      }
      return frame
    }
    if (this.ended) return null
    return this.last // decoder underrun: hold the last frame rather than drop to slate
  }

  stop() {
    this.ended = true
    this.queue = []
    if (this.child.exitCode === null && !this.child.killed) this.child.kill('SIGKILL')
  }
}

function fitFilter(cfg: Pick<WorkerConfig, 'width' | 'height'>) {
  const { width: w, height: h } = cfg
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${BACKGROUND}`
}

/** Runs ffmpeg and returns exactly one raw frame from stdout. */
function captureFrame(cfg: WorkerConfig, args: string[], signal?: AbortSignal): Promise<Buffer> {
  const size = frameSize(cfg)
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
      cwd: cfg.workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      signal,
    })
    const chunks: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.stderr.on('data', (d) => { stderr = (stderr + String(d)).slice(-2000) })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const out = Buffer.concat(chunks)
      if (code === 0 && out.length >= size) resolve(Buffer.from(out.subarray(0, size)))
      else reject(new Error(`ffmpeg render failed (exit ${code}): ${redactSecrets(stderr.trim().slice(-300), cfg.redact)}`))
    })
  })
}

/** Copies the configured font into the work dir so filter arguments never contain drive letters or quotes. */
export async function prepareFont(cfg: WorkerConfig) {
  await fs.copyFile(cfg.fontFile, path.join(cfg.workDir, FONT_COPY_NAME))
}

function drawText(textFile: string, opts: { size: number; color: string; x: number; y: number; lineSpacing?: number }) {
  return [
    `drawtext=fontfile=${FONT_COPY_NAME}`,
    `textfile=${textFile}`,
    'expansion=none', // user text is never interpreted as %{...} expressions
    `fontsize=${opts.size}`,
    `fontcolor=${opts.color}`,
    `x=${opts.x}`,
    `y=${opts.y}`,
    ...(opts.lineSpacing ? [`line_spacing=${opts.lineSpacing}`] : []),
  ].join(':')
}

/** Renders a text card (header, wrapped body, @name) into one frame. */
export async function renderTextFrame(cfg: WorkerConfig, body: string, displayName: string, signal?: AbortSignal) {
  const margin = 64
  const top = 170
  const bottom = cfg.height - 110
  const layout = layoutText(body, cfg.width - margin * 2, bottom - top)
  const id = `txt-${randomUUID()}`
  const files = {
    header: `${id}-header.txt`,
    body: `${id}-body.txt`,
    name: `${id}-name.txt`,
  }
  const name = normalizeText(displayName).replace(/\s+/g, ' ').slice(0, 32) || 'community'
  await Promise.all([
    fs.writeFile(path.join(cfg.workDir, files.header), 'WrittenBoard', 'utf8'),
    fs.writeFile(path.join(cfg.workDir, files.body), layout.lines.join('\n') || ' ', 'utf8'),
    fs.writeFile(path.join(cfg.workDir, files.name), `@${name}`, 'utf8'),
  ])
  try {
    const filter = [
      drawText(files.header, { size: 40, color: '0xffffff', x: margin, y: 64 }),
      drawText(files.body, { size: layout.fontSize, color: '0xf4f4f5', x: margin, y: top, lineSpacing: layout.lineSpacing }),
      drawText(files.name, { size: 28, color: '0xa1a1aa', x: margin, y: cfg.height - 80 }),
      'format=yuv420p',
    ].join(',')
    return await captureFrame(cfg, [
      '-f', 'lavfi', '-i', `color=c=${BACKGROUND}:s=${cfg.width}x${cfg.height}:d=1`,
      '-vf', filter, '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1',
    ], signal)
  } finally {
    await Promise.all(Object.values(files).map((f) => fs.rm(path.join(cfg.workDir, f), { force: true })))
  }
}

/** The idle card shown between items and while UGC is paused. */
export function renderSlateFrame(cfg: WorkerConfig) {
  return renderTextFrame(cfg, 'Submissions go on air here after moderation.\n\nwrittenboard.com', 'WrittenBoard')
}

export const IMAGE_DEMUXERS: Record<string, string> = {
  'image/jpeg': 'jpeg_pipe',
  'image/png': 'png_pipe',
  'image/webp': 'webp_pipe',
}
export const VIDEO_DEMUXERS: Record<string, string> = {
  'video/mp4': 'mov',
  'video/webm': 'matroska',
}

export function renderImageFrame(cfg: WorkerConfig, file: string, mimeType: string, signal?: AbortSignal) {
  const demuxer = IMAGE_DEMUXERS[mimeType]
  if (!demuxer) throw new Error(`Unsupported image type ${mimeType}`)
  return captureFrame(cfg, [
    '-protocol_whitelist', 'file',
    '-f', demuxer, '-i', file,
    '-vf', `${fitFilter(cfg)},format=yuv420p`, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1',
  ], signal)
}
