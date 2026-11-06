/**
 * Continuous output. One long-lived ffmpeg encoder holds the RTMP connection for
 * the whole session; a fixed-rate clock feeds it a frame every tick from the
 * current item, or the slate when nothing is on air. Items change without the
 * stream ever disconnecting.
 *
 * Record mode writes a local FLV. File open/exit failures are fatal (no restart
 * against the same path). RTMP mode keeps the historical reconnect-with-backoff
 * behavior.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { redactSecrets, type WorkerConfig } from './config'
import type { FrameSource } from './frames'

export interface FrameSink {
  write(frame: Buffer): void
  readonly isUp: boolean
}

export class NullSink implements FrameSink {
  frames = 0
  readonly isUp = true
  write() { this.frames++ }
}

export type PlayResult = 'ended' | 'aborted'

interface Current {
  source: FrameSource
  resolve: (result: PlayResult) => void
}

export class Compositor {
  private current: Current | null = null
  private timer: NodeJS.Timeout | null = null
  private t0 = 0
  private sent = 0
  private readonly frameMs: number

  constructor(fps: number, private readonly sink: FrameSink, private slate: Buffer) {
    this.frameMs = 1000 / fps
  }

  get onAir() { return this.current !== null }

  setSlate(frame: Buffer) { this.slate = frame }

  start() {
    if (this.timer) return
    this.t0 = performance.now()
    this.sent = 0
    this.schedule()
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.finishCurrent('aborted')
  }

  /** Puts a source on air; resolves when it ends or the signal aborts. */
  play(source: FrameSource, signal: AbortSignal): Promise<PlayResult> {
    this.finishCurrent('aborted')
    if (signal.aborted) {
      source.stop()
      return Promise.resolve('aborted')
    }
    return new Promise<PlayResult>((resolve) => {
      const onAbort = () => {
        if (this.current?.source === source) this.finishCurrent('aborted')
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.current = {
        source,
        resolve: (result) => {
          signal.removeEventListener('abort', onAbort)
          resolve(result)
        },
      }
    })
  }

  /** Produces the frame for one tick. Public for tests. */
  produceFrame(): Buffer {
    if (this.current) {
      const frame = this.current.source.nextFrame()
      if (frame) return frame
      this.finishCurrent('ended')
    }
    return this.slate
  }

  private finishCurrent(result: PlayResult) {
    const current = this.current
    if (!current) return
    this.current = null
    current.source.stop()
    current.resolve(result)
  }

  private schedule() {
    const due = this.t0 + (this.sent + 1) * this.frameMs
    this.timer = setTimeout(() => this.tick(), Math.max(0, due - performance.now()))
  }

  private tick() {
    const due = Math.floor((performance.now() - this.t0) / this.frameMs)
    let behind = due - this.sent
    if (behind > 15) {
      // The event loop stalled badly; skip ahead instead of bursting frames.
      this.sent = due - 1
      behind = 1
    }
    for (let i = 0; i < Math.max(1, behind); i++) {
      this.sink.write(this.produceFrame())
      this.sent++
    }
    if (this.timer) this.schedule()
  }
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

export interface EncoderSinkOptions {
  spawn?: SpawnFn
  /** How long a file recorder must stay alive before we treat startup as successful. */
  fileStartupGraceMs?: number
}

/** True when the encoder target is a live RTMP(S) URL rather than a local file. */
export function isRtmpOutputTarget(target: string): boolean {
  return /^rtmps?:\/\//i.test(target.trim())
}

/** Long-lived ffmpeg encoder. RTMP reconnects with backoff; file recording fails closed. */
export class EncoderSink implements FrameSink {
  private child: ChildProcess | null = null
  private stopping = false
  private backoffMs = 1000
  private startedAt = 0
  private restartTimer: NodeJS.Timeout | null = null
  private dropped = 0
  private fatalError: Error | null = null
  private readonly spawnFn: SpawnFn
  private readonly fileStartupGraceMs: number
  private readonly rtmp: boolean

  constructor(
    private readonly cfg: WorkerConfig,
    private readonly log: (msg: string) => void,
    opts: EncoderSinkOptions = {},
  ) {
    this.spawnFn = opts.spawn || spawn
    this.fileStartupGraceMs = opts.fileStartupGraceMs ?? 1500
    this.rtmp = isRtmpOutputTarget(cfg.outputTarget || '')
  }

  get isUp() {
    return (
      !this.fatalError &&
      !!this.child &&
      this.child.exitCode === null &&
      !!this.child.stdin?.writable
    )
  }

  get lastError() {
    return this.fatalError
  }

  args() {
    const { cfg } = this
    const gop = String(cfg.fps * 2) // 2s keyframes, as YouTube recommends
    const out = cfg.outputTarget!
    // -y only for local files (unique per-run paths). Never used for RTMP URLs.
    return [
      '-hide_banner', '-loglevel', 'warning', '-nostdin',
      '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${cfg.width}x${cfg.height}`, '-r', String(cfg.fps), '-i', 'pipe:0',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-b:v', `${cfg.videoBitrateKbps}k`, '-maxrate', `${cfg.videoBitrateKbps}k`, '-bufsize', `${cfg.videoBitrateKbps * 2}k`,
      '-g', gop, '-keyint_min', gop, '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-shortest', // end when the frame pipe closes (the silent audio track is infinite)
      ...(this.rtmp ? [] : ['-y']),
      '-f', 'flv', out,
    ]
  }

  /** Spawns ffmpeg. For file targets, resolves only after a short healthy grace period. */
  async start(): Promise<void> {
    if (!this.cfg.outputTarget) throw new Error('No output target configured')
    this.stopping = false
    this.fatalError = null
    await this.spawnEncoder()
  }

  private markFatal(err: Error) {
    if (!this.fatalError) this.fatalError = err
  }

  private spawnEncoder(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopping) {
        resolve()
        return
      }

      const child = this.spawnFn(this.cfg.ffmpeg, this.args(), {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      })
      this.child = child
      this.startedAt = Date.now()
      let stderr = ''
      let startupSettled = false

      const failStartup = (err: Error) => {
        if (startupSettled) return
        startupSettled = true
        this.markFatal(err)
        reject(err)
      }

      const succeedStartup = () => {
        if (startupSettled) return
        startupSettled = true
        this.log(this.rtmp ? 'encoder started' : `encoder started (recording ${this.cfg.outputTarget})`)
        resolve()
      }

      child.stdin?.on('error', () => { /* EPIPE when the encoder dies; handled on close */ })
      child.stderr?.on('data', (d) => {
        stderr = (stderr + String(d)).slice(-4000)
      })
      child.on('error', (err) => {
        this.log(`encoder failed to start: ${err.message}`)
        this.markFatal(err)
        if (!this.rtmp) failStartup(err)
      })
      child.on('close', (code) => {
        if (this.child === child) this.child = null
        if (this.stopping) return
        const tail = redactSecrets(stderr.trim().split('\n').slice(-5).join(' | '), this.cfg.redact)

        if (!this.rtmp) {
          const detail = tail || '(no ffmpeg stderr)'
          const err = new Error(
            code === 0
              ? `Recording encoder exited unexpectedly (0) before/while writing ${this.cfg.outputTarget}. ${detail}`
              : `Recording encoder exited (${code}) for ${this.cfg.outputTarget}. ${detail}`,
          )
          this.markFatal(err)
          this.log(err.message)
          // Never restart a local file encoder against the same FLV target.
          failStartup(err)
          return
        }

        if (Date.now() - this.startedAt > 60_000) this.backoffMs = 1000
        this.log(`encoder exited (${code}); restarting in ${this.backoffMs}ms. ${tail}`)
        this.restartTimer = setTimeout(() => {
          void this.spawnEncoder().catch((err) => {
            this.log(`encoder restart failed: ${(err as Error).message}`)
          })
        }, this.backoffMs)
        this.backoffMs = Math.min(30_000, this.backoffMs * 2)
      })

      if (this.rtmp) {
        succeedStartup()
        return
      }

      // File mode: a failed open exits almost immediately. Do not claim "started" yet.
      setTimeout(() => {
        if (startupSettled) return
        if (this.child === child && child.exitCode === null && !this.fatalError) {
          succeedStartup()
        }
      }, this.fileStartupGraceMs)
    })
  }

  write(frame: Buffer) {
    if (this.fatalError) return
    const stdin = this.child?.stdin
    if (!stdin || !stdin.writable) return // encoder down/restarting: frames are dropped
    // If the encoder cannot keep up, drop rather than buffer without bound.
    if (stdin.writableLength > frame.length * 10) {
      if (++this.dropped % 150 === 1) this.log(`encoder is behind; dropped ${this.dropped} frames so far`)
      return
    }
    stdin.write(frame)
  }

  async stop() {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    const child = this.child
    if (!child) return
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
      child.once('close', () => { clearTimeout(kill); resolve() })
      child.stdin?.end() // lets ffmpeg flush and close the RTMP session / finalize the file
    })
  }
}
