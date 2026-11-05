import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type BroadcastMode = 'dry-run' | 'rtmp' | 'record'
type Env = Record<string, string | undefined>

export interface WorkerConfig {
  mode: BroadcastMode
  ffmpeg: string
  fontFile: string
  /** How long text and image items stay on screen. */
  holdMs: number
  pollMs: number
  workDir: string
  width: number
  height: number
  fps: number
  videoBitrateKbps: number
  maxVideoSeconds: number
  /** Playback attempts per queue item before it is marked failed. */
  maxAttempts: number
  leaseTtlMs: number
  leaseRenewMs: number
  workerId: string
  /** Where the encoder sends the stream. Contains the stream key in rtmp mode: never log it. */
  outputTarget: string | null
  /** Secret strings to scrub from any logged ffmpeg output. */
  redact: string[]
  healthPort: number | null
}

function intFromEnv(env: Env, name: string, fallback: number, min: number, max: number) {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`)
  }
  return Math.round(value)
}

export function defaultFontFile(platform: NodeJS.Platform = process.platform) {
  if (platform === 'win32') return 'C:/Windows/Fonts/arial.ttf'
  if (platform === 'darwin') return '/System/Library/Fonts/Supplemental/Arial.ttf'
  return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
}

export function loadConfig(env: Env = process.env): WorkerConfig {
  const mode = (env.BROADCAST_MODE || 'dry-run').toLowerCase()
  if (mode !== 'dry-run' && mode !== 'rtmp' && mode !== 'record') {
    throw new Error(`Unknown BROADCAST_MODE "${mode}" (use dry-run, record or rtmp)`)
  }
  const workDir = path.resolve(env.BROADCAST_WORK_DIR || path.join(process.cwd(), 'workers', '.work'))
  const streamKey = env.YOUTUBE_STREAM_KEY || ''
  if (mode === 'rtmp' && !streamKey) throw new Error('YOUTUBE_STREAM_KEY is required for rtmp mode')

  let outputTarget: string | null = null
  if (mode === 'rtmp') {
    const base = (env.BROADCAST_RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/+$/, '')
    outputTarget = `${base}/${streamKey}`
  } else if (mode === 'record') {
    outputTarget = path.resolve(env.BROADCAST_RECORD_FILE || path.join(workDir, `record-${Date.now()}.flv`))
  }

  const leaseTtlMs = intFromEnv(env, 'BROADCAST_LEASE_TTL_MS', 30_000, 10_000, 600_000)

  return {
    mode,
    ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
    fontFile: env.BROADCAST_FONT_FILE || defaultFontFile(),
    holdMs: intFromEnv(env, 'BROADCAST_HOLD_MS', 8000, 1000, 120_000),
    pollMs: intFromEnv(env, 'BROADCAST_POLL_MS', 3000, 250, 60_000),
    workDir,
    width: 1280,
    height: 720,
    fps: intFromEnv(env, 'BROADCAST_FPS', 30, 10, 60),
    videoBitrateKbps: intFromEnv(env, 'BROADCAST_VIDEO_KBPS', 2500, 500, 12_000),
    maxVideoSeconds: 15,
    maxAttempts: intFromEnv(env, 'BROADCAST_MAX_ATTEMPTS', 3, 1, 10),
    leaseTtlMs,
    leaseRenewMs: Math.max(2000, Math.floor(leaseTtlMs / 3)),
    workerId: `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
    outputTarget,
    redact: streamKey ? [streamKey] : [],
    healthPort: env.PORT ? intFromEnv(env, 'PORT', 8080, 1, 65_535) : null,
  }
}

export function redactSecrets(text: string, secrets: string[]) {
  let out = text
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***')
  }
  return out
}
