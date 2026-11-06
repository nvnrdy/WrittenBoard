/**
 * Prepares local files OBS can read. Never pushes Storage URLs into OBS.
 * Video is hard-capped to cfg.maxVideoSeconds before OBS sees the path.
 */
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { layoutText, normalizeText } from '../text-layout'
import { BACKGROUND, FONT_COPY_NAME, IMAGE_DEMUXERS, VIDEO_DEMUXERS, prepareFont } from '../frames'
import { redactSecrets, type WorkerConfig } from '../config'
import type { ClaimedItem } from '../queue'

type Bucket = { file(path: string): { createReadStream(): NodeJS.ReadableStream } }

export type ObsPreparedMedia =
  | { kind: 'text'; filePath: string; holdMs: number }
  | { kind: 'image'; filePath: string; holdMs: number }
  | { kind: 'video'; filePath: string; maxMs: number }

function stagingPath(cfg: WorkerConfig, claimId: string, suffix: string) {
  const safe = claimId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36) || randomUUID().slice(0, 8)
  return path.join(cfg.workDir, `obs-${safe}-${suffix}`)
}

async function downloadTo(bucket: Bucket, storagePath: string, dest: string, signal: AbortSignal) {
  await pipeline(bucket.file(storagePath).createReadStream(), createWriteStream(dest), { signal })
}

function runFfmpeg(cfg: WorkerConfig, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
      cwd: cfg.workDir,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      signal,
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr = (stderr + String(d)).slice(-2000) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg failed (exit ${code}): ${redactSecrets(stderr.trim().slice(-300), cfg.redact)}`))
    })
  })
}

function drawText(textFile: string, opts: { size: number; color: string; x: number; y: number; lineSpacing?: number }) {
  return [
    `drawtext=fontfile=${FONT_COPY_NAME}`,
    `textfile=${textFile}`,
    'expansion=none',
    `fontsize=${opts.size}`,
    `fontcolor=${opts.color}`,
    `x=${opts.x}`,
    `y=${opts.y}`,
    ...(opts.lineSpacing ? [`line_spacing=${opts.lineSpacing}`] : []),
  ].join(':')
}

/** Renders a text card to a PNG file for the WB Text image source. */
export async function renderTextPng(cfg: WorkerConfig, body: string, displayName: string, destPath: string, signal: AbortSignal) {
  await prepareFont(cfg)
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
    ].join(',')
    await runFfmpeg(cfg, [
      '-f', 'lavfi', '-i', `color=c=${BACKGROUND}:s=${cfg.width}x${cfg.height}:d=1`,
      '-vf', filter,
      '-frames:v', '1',
      destPath,
    ], signal)
  } finally {
    await Promise.all(Object.values(files).map((f) => fs.rm(path.join(cfg.workDir, f), { force: true })))
  }
}

async function prepareImage(
  cfg: WorkerConfig,
  srcFile: string,
  mimeType: string,
  destPath: string,
  signal: AbortSignal,
) {
  const demuxer = IMAGE_DEMUXERS[mimeType]
  if (!demuxer) throw new Error(`Unsupported image type ${mimeType}`)
  const { width: w, height: h } = cfg
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${BACKGROUND}`
  await runFfmpeg(cfg, [
    '-protocol_whitelist', 'file',
    '-f', demuxer, '-i', srcFile,
    '-vf', vf,
    '-frames:v', '1',
    destPath,
  ], signal)
}

/**
 * Remux/transcode to a local MP4 capped at maxVideoSeconds.
 * OBS never sees the original uncapped download.
 */
async function prepareVideo(
  cfg: WorkerConfig,
  srcFile: string,
  mimeType: string,
  destPath: string,
  signal: AbortSignal,
) {
  if (!VIDEO_DEMUXERS[mimeType]) throw new Error(`Unsupported video type ${mimeType}`)
  await runFfmpeg(cfg, [
    '-protocol_whitelist', 'file',
    '-i', srcFile,
    '-t', String(cfg.maxVideoSeconds),
    '-an', '-sn', '-dn',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    destPath,
  ], signal)
}

export async function prepareObsMedia(
  cfg: WorkerConfig,
  item: ClaimedItem,
  bucket: Bucket,
  signal: AbortSignal,
): Promise<{ media: ObsPreparedMedia; cleanupPaths: string[] }> {
  const cleanupPaths: string[] = []
  const holdMs = cfg.holdMs

  if (item.type === 'text') {
    if (!item.contentText) throw new Error('Text item has no content')
    const filePath = stagingPath(cfg, item.claimId, 'text.png')
    cleanupPaths.push(filePath)
    await renderTextPng(cfg, item.contentText, item.displayName, filePath, signal)
    return { media: { kind: 'text', filePath, holdMs }, cleanupPaths }
  }

  if (!item.storagePath) throw new Error('Media item has no storagePath (media may have been purged)')
  if (!item.mimeType) throw new Error('Media item has no mimeType')

  const downloadPath = stagingPath(cfg, item.claimId, `download.bin`)
  cleanupPaths.push(downloadPath)
  await downloadTo(bucket, item.storagePath, downloadPath, signal)
  if (signal.aborted) throw new Error('aborted')

  if (item.type === 'image') {
    const filePath = stagingPath(cfg, item.claimId, 'image.png')
    cleanupPaths.push(filePath)
    await prepareImage(cfg, downloadPath, item.mimeType, filePath, signal)
    return { media: { kind: 'image', filePath, holdMs }, cleanupPaths }
  }

  const filePath = stagingPath(cfg, item.claimId, 'video.mp4')
  cleanupPaths.push(filePath)
  await prepareVideo(cfg, downloadPath, item.mimeType, filePath, signal)
  const maxMs = Math.min(
    cfg.maxVideoSeconds * 1000,
    Math.max(1000, Math.round((item.durationSeconds ?? cfg.maxVideoSeconds) * 1000)),
  )
  return { media: { kind: 'video', filePath, maxMs }, cleanupPaths }
}

export async function cleanupFiles(paths: string[]) {
  await Promise.all(paths.map((p) => fs.rm(p, { force: true }).catch(() => undefined)))
}
