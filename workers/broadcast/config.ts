import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_OBS_SCENES, DEFAULT_OBS_SOURCES, DEFAULT_OBS_WEBSOCKET_URL } from './obs/constants'

export type BroadcastMode = 'dry-run' | 'rtmp' | 'record' | 'obs'
type Env = Record<string, string | undefined>

export interface ObsWorkerConfig {
  websocketUrl: string
  /** Present only in memory for connect(); included in redact; never log. */
  password: string
  sceneHolding: string
  sceneContent: string
  sourceHoldingBg: string
  sourceContentBg: string
  sourceText: string
  sourceImage: string
  sourceVideo: string
}

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
  /** Secret strings to scrub from any logged ffmpeg/OBS output. */
  redact: string[]
  healthPort: number | null
  /** Present only when mode === 'obs'. */
  obs: ObsWorkerConfig | null
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

/**
 * OBS mode may only target loopback. Default ws://127.0.0.1:4455.
 * Rejects non-loopback hosts to fail closed against remote OBS.
 */
export function parseObsWebsocketUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`OBS_WEBSOCKET_URL is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('OBS_WEBSOCKET_URL must use ws:// or wss://')
  }
  const host = url.hostname.toLowerCase()
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('OBS_WEBSOCKET_URL must target 127.0.0.1 or localhost (fail closed)')
  }
  // Normalize localhost → 127.0.0.1 for a stable default contract.
  const port = url.port || '4455'
  if (port !== '4455') {
    throw new Error('OBS_WEBSOCKET_URL must use port 4455 (fail closed)')
  }
  return `ws://127.0.0.1:4455`
}

function loadObsConfig(env: Env): ObsWorkerConfig {
  if (env.YOUTUBE_STREAM_KEY) {
    throw new Error('OBS mode must not use YOUTUBE_STREAM_KEY (OBS owns the YouTube connection)')
  }
  if (env.BROADCAST_RTMP_URL) {
    throw new Error('OBS mode must not use BROADCAST_RTMP_URL (OBS owns the YouTube connection)')
  }
  const password = env.OBS_WEBSOCKET_PASSWORD || ''
  if (!password) {
    throw new Error('OBS_WEBSOCKET_PASSWORD is required for obs mode')
  }
  const websocketUrl = parseObsWebsocketUrl(env.OBS_WEBSOCKET_URL || DEFAULT_OBS_WEBSOCKET_URL)
  return {
    websocketUrl,
    password,
    sceneHolding: env.OBS_SCENE_HOLDING || DEFAULT_OBS_SCENES.holding,
    sceneContent: env.OBS_SCENE_CONTENT || DEFAULT_OBS_SCENES.content,
    sourceHoldingBg: env.OBS_SOURCE_HOLDING_BG || DEFAULT_OBS_SOURCES.holdingBg,
    sourceContentBg: env.OBS_SOURCE_CONTENT_BG || DEFAULT_OBS_SOURCES.contentBg,
    sourceText: env.OBS_SOURCE_TEXT || DEFAULT_OBS_SOURCES.text,
    sourceImage: env.OBS_SOURCE_IMAGE || DEFAULT_OBS_SOURCES.image,
    sourceVideo: env.OBS_SOURCE_VIDEO || DEFAULT_OBS_SOURCES.video,
  }
}

export function loadConfig(env: Env = process.env): WorkerConfig {
  const mode = (env.BROADCAST_MODE || 'dry-run').toLowerCase()
  if (mode !== 'dry-run' && mode !== 'rtmp' && mode !== 'record' && mode !== 'obs') {
    throw new Error(`Unknown BROADCAST_MODE "${mode}" (use dry-run, record, rtmp or obs)`)
  }
  const workDir = path.resolve(env.BROADCAST_WORK_DIR || path.join(process.cwd(), 'workers', '.work'))
  const streamKey = env.YOUTUBE_STREAM_KEY || ''
  if (mode === 'rtmp' && !streamKey) throw new Error('YOUTUBE_STREAM_KEY is required for rtmp mode')

  const obs = mode === 'obs' ? loadObsConfig(env) : null

  let outputTarget: string | null = null
  if (mode === 'rtmp') {
    const base = (env.BROADCAST_RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/+$/, '')
    outputTarget = `${base}/${streamKey}`
  } else if (mode === 'record') {
    outputTarget = path.resolve(env.BROADCAST_RECORD_FILE || path.join(workDir, `record-${Date.now()}.flv`))
  } else if (mode === 'obs') {
    // OBS owns YouTube; worker never builds an RTMP target.
    outputTarget = null
  }

  const leaseTtlMs = intFromEnv(env, 'BROADCAST_LEASE_TTL_MS', 30_000, 10_000, 600_000)
  const redact = [
    ...(streamKey ? [streamKey] : []),
    ...(obs?.password ? [obs.password] : []),
  ]

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
    redact,
    healthPort: env.PORT ? intFromEnv(env, 'PORT', 8080, 1, 65_535) : null,
    obs,
  }
}

export function redactSecrets(text: string, secrets: string[]) {
  let out = text
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***')
  }
  return out
}
