/**
 * Controls WB Holding / WB Content presentation over OBS WebSocket v5.
 *
 * Command ack ≠ verified on-screen presentation: after scene/source changes we
 * re-read program scene / media state. That still is not YouTube broadcast proof.
 *
 * Generation tokens: each present() bumps a token; late MediaInputPlaybackEnded
 * from a prior claim cannot complete a later item.
 */
import type { WorkerConfig } from '../config'
import type { ClaimedItem } from '../queue'
import type { PlayOutcome } from '../transitions'
import type { ObsClient } from './client'
import { DEFAULT_OBS_SCENES, DEFAULT_OBS_SOURCES, ObsMediaInputAction, ObsMediaState } from './constants'
import { cleanupFiles, prepareObsMedia, type ObsPreparedMedia } from './media'

export type ObsPresentResult =
  | { outcome: 'completed'; error: null; holdingRestored: boolean }
  | { outcome: Exclude<PlayOutcome, 'completed'>; error: string | null; holdingRestored: boolean }

export interface HoldingAttempt {
  /** True only when OBS confirmed the Holding program scene after cleanup. */
  restored: boolean
  /** False when OBS was disconnected or confirmation failed. */
  ok: boolean
  reason?: string
}

type SceneItem = { sceneItemId: number; sourceName: string; sceneItemEnabled?: boolean }

function asSceneItems(raw: unknown): SceneItem[] {
  if (!Array.isArray(raw)) return []
  const out: SceneItem[] = []
  for (const row of raw) {
    const r = row as Record<string, unknown>
    const sceneItemId = Number(r.sceneItemId)
    const sourceName = String(r.sourceName || '')
    if (!Number.isFinite(sceneItemId) || !sourceName) continue
    out.push({ sceneItemId, sourceName, sceneItemEnabled: Boolean(r.sceneItemEnabled) })
  }
  return out
}

function abortOutcome(reason: unknown): Exclude<PlayOutcome, 'completed'> {
  if (reason === 'skipped' || reason === 'cancelled' || reason === 'interrupted' || reason === 'failed') {
    return reason
  }
  return 'interrupted'
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class ObsPresenter {
  private generation = 0
  private activeGeneration = 0
  private contentItems = new Map<string, number>()
  private holdingItems = new Map<string, number>()
  private disconnectHandler: ((err?: Error) => void) | null = null
  private lastError: string | null = null
  private started = false

  constructor(
    private readonly client: ObsClient,
    private readonly cfg: WorkerConfig,
    private readonly log: (msg: string) => void,
  ) {}

  get connected() {
    return this.client.connected
  }

  get lastObsError() {
    return this.lastError
  }

  /**
   * True when OBS is connected and startup verification succeeded.
   * Holding-restore warnings after a verified presentation do not flip this false
   * (those are surfaced via holdingRestored / lastObsError instead).
   */
  ok() {
    return this.client.connected && this.started
  }

  private sceneNames() {
    return {
      holding: this.cfg.obs?.sceneHolding || DEFAULT_OBS_SCENES.holding,
      content: this.cfg.obs?.sceneContent || DEFAULT_OBS_SCENES.content,
    }
  }

  private sourceNames() {
    return {
      holdingBg: this.cfg.obs?.sourceHoldingBg || DEFAULT_OBS_SOURCES.holdingBg,
      contentBg: this.cfg.obs?.sourceContentBg || DEFAULT_OBS_SOURCES.contentBg,
      text: this.cfg.obs?.sourceText || DEFAULT_OBS_SOURCES.text,
      image: this.cfg.obs?.sourceImage || DEFAULT_OBS_SOURCES.image,
      video: this.cfg.obs?.sourceVideo || DEFAULT_OBS_SOURCES.video,
    }
  }

  private requireConnected() {
    if (!this.client.connected) {
      this.lastError = 'OBS WebSocket is not connected'
      throw new Error(this.lastError)
    }
  }

  private bumpGeneration() {
    this.generation += 1
    this.activeGeneration = this.generation
    return this.activeGeneration
  }

  /** Invalidate in-flight playback so late media events cannot complete. */
  invalidatePlayback() {
    this.generation += 1
    this.activeGeneration = this.generation
  }

  isCurrentGeneration(token: number) {
    return token === this.activeGeneration && this.client.connected
  }

  async startup(): Promise<void> {
    this.requireConnected()
    const scenes = this.sceneNames()
    const sources = this.sourceNames()

    const list = await this.client.call('GetSceneList')
    const names = new Set(
      (Array.isArray(list.scenes) ? list.scenes : []).map((s) => String((s as { sceneName?: string }).sceneName || '')),
    )
    for (const required of [scenes.holding, scenes.content]) {
      if (!names.has(required)) {
        throw new Error(`OBS scene "${required}" is missing. Create the WrittenBoard scene contract before starting obs mode.`)
      }
    }

    this.holdingItems = await this.loadSceneItems(scenes.holding)
    this.contentItems = await this.loadSceneItems(scenes.content)

    for (const name of [sources.holdingBg]) {
      if (!this.holdingItems.has(name)) {
        throw new Error(`OBS source "${name}" missing from scene "${scenes.holding}"`)
      }
    }
    for (const name of [sources.contentBg, sources.text, sources.image, sources.video]) {
      if (!this.contentItems.has(name)) {
        throw new Error(`OBS source "${name}" missing from scene "${scenes.content}"`)
      }
    }

    this.disconnectHandler = () => {
      this.lastError = 'OBS WebSocket disconnected'
      this.invalidatePlayback()
      this.log('OBS WebSocket disconnected')
    }
    this.client.on('ConnectionClosed', this.disconnectHandler)

    // Audio policy: content video is always muted (parity with compositor -an).
    await this.client.call('SetInputMute', { inputName: sources.video, inputMuted: true })

    const holding = await this.attemptHolding('startup')
    if (!holding.restored) {
      throw new Error(holding.reason || 'Could not confirm Holding scene at startup')
    }
    this.started = true
    this.lastError = null
    this.log(`OBS presenter ready (Holding="${scenes.holding}", Content="${scenes.content}")`)
  }

  async shutdown(): Promise<HoldingAttempt> {
    this.invalidatePlayback()
    const holding = await this.attemptHolding('shutdown')
    if (this.disconnectHandler) {
      this.client.off('ConnectionClosed', this.disconnectHandler)
      this.disconnectHandler = null
    }
    this.started = false
    return holding
  }

  /**
   * Switch to Holding, stop media, clear content file paths.
   * Never reports restored=true when OBS is disconnected.
   */
  async attemptHolding(reason: string): Promise<HoldingAttempt> {
    if (!this.client.connected) {
      return { ok: false, restored: false, reason: `OBS disconnected; Holding not restored (${reason})` }
    }
    try {
      await this.stopAndClearContent()
      const scenes = this.sceneNames()
      const sources = this.sourceNames()
      await this.setEnabled(scenes.holding, sources.holdingBg, true)
      await this.client.call('SetCurrentProgramScene', { sceneName: scenes.holding })
      const current = await this.client.call('GetCurrentProgramScene')
      const name = current.sceneName || current.currentProgramSceneName
      if (name !== scenes.holding) {
        return { ok: false, restored: false, reason: `Holding scene not confirmed (program="${name}")` }
      }
      return { ok: true, restored: true }
    } catch (err) {
      const message = (err as Error).message
      this.lastError = message
      return { ok: false, restored: false, reason: message }
    }
  }

  private async loadSceneItems(sceneName: string) {
    const res = await this.client.call('GetSceneItemList', { sceneName })
    const map = new Map<string, number>()
    for (const item of asSceneItems(res.sceneItems)) {
      map.set(item.sourceName, item.sceneItemId)
    }
    return map
  }

  private async setEnabled(sceneName: string, sourceName: string, enabled: boolean) {
    const id = (sceneName === this.sceneNames().holding ? this.holdingItems : this.contentItems).get(sourceName)
    if (id === undefined) throw new Error(`Unknown scene item ${sourceName} in ${sceneName}`)
    await this.client.call('SetSceneItemEnabled', {
      sceneName,
      sceneItemId: id,
      sceneItemEnabled: enabled,
    })
  }

  private async stopAndClearContent() {
    const scenes = this.sceneNames()
    const sources = this.sourceNames()
    // Stop video first so OBS releases file locks before we blank paths.
    try {
      await this.client.call('TriggerMediaInputAction', {
        inputName: sources.video,
        mediaAction: ObsMediaInputAction.STOP,
      })
    } catch {
      // source may already be stopped
    }
    await this.setEnabled(scenes.content, sources.text, false)
    await this.setEnabled(scenes.content, sources.image, false)
    await this.setEnabled(scenes.content, sources.video, false)
    await this.setEnabled(scenes.content, sources.contentBg, true)

    // Blank file paths so a restart cannot show stale/revoked media.
    await this.client.call('SetInputSettings', {
      inputName: sources.text,
      overlay: true,
      inputSettings: { file: '', unload: true },
    })
    await this.client.call('SetInputSettings', {
      inputName: sources.image,
      overlay: true,
      inputSettings: { file: '', unload: true },
    })
    await this.client.call('SetInputSettings', {
      inputName: sources.video,
      overlay: true,
      inputSettings: { local_file: '', is_local_file: true },
    })
  }

  /**
   * Present one claimed item. Callers must only treat outcome=completed as
   * eligible for played_obs after this returns completed with holdingRestored
   * (or an explicit post-check). Command ack alone never implies YouTube broadcast.
   */
  async present(
    item: ClaimedItem,
    bucket: { file(path: string): { createReadStream(): NodeJS.ReadableStream } },
    signal: AbortSignal,
  ): Promise<ObsPresentResult> {
    const token = this.bumpGeneration()
    const cleanupPaths: string[] = []
    let holdingRestored = false

    const finishAbort = async (outcome: Exclude<PlayOutcome, 'completed'>, error: string | null): Promise<ObsPresentResult> => {
      this.invalidatePlayback()
      const holding = await this.attemptHolding(`abort:${outcome}`)
      holdingRestored = holding.restored
      await cleanupFiles(cleanupPaths)
      return { outcome, error, holdingRestored }
    }

    try {
      this.requireConnected()
      if (signal.aborted) return finishAbort(abortOutcome(signal.reason), null)

      const prepared = await prepareObsMedia(this.cfg, item, bucket, signal)
      cleanupPaths.push(...prepared.cleanupPaths)
      if (!this.isCurrentGeneration(token) || signal.aborted) {
        return finishAbort(abortOutcome(signal.reason), null)
      }

      await this.showMedia(prepared.media, token)
      if (!this.isCurrentGeneration(token) || signal.aborted) {
        return finishAbort(abortOutcome(signal.reason), null)
      }

      // Verified presentation gate: program scene must be Content after switch.
      const scenes = this.sceneNames()
      await this.client.call('SetCurrentProgramScene', { sceneName: scenes.content })
      const current = await this.client.call('GetCurrentProgramScene')
      const program = current.sceneName || current.currentProgramSceneName
      if (program !== scenes.content) {
        throw new Error(`Content scene not confirmed (program="${program}")`)
      }
      if (!this.isCurrentGeneration(token)) {
        return finishAbort('interrupted', 'playback generation invalidated')
      }

      await this.waitForPresentation(prepared.media, token, signal)
      if (!this.isCurrentGeneration(token)) {
        return finishAbort(abortOutcome(signal.reason), null)
      }
      if (!this.client.connected) {
        return finishAbort('failed', 'OBS disconnected before presentation completed')
      }

      const holding = await this.attemptHolding('completed')
      holdingRestored = holding.restored
      await cleanupFiles(cleanupPaths)
      if (!holding.restored) {
        // Presentation completed but Holding could not be confirmed — still completed
        // for the item, but surface the Holding issue for the worker health loop.
        this.lastError = holding.reason || 'Holding not restored after presentation'
      } else {
        this.lastError = null
      }
      return { outcome: 'completed', error: null, holdingRestored }
    } catch (err) {
      if (signal.aborted) return finishAbort(abortOutcome(signal.reason), null)
      const message = (err as Error).message || 'OBS presentation failed'
      this.lastError = message
      this.invalidatePlayback()
      const holding = await this.attemptHolding('failed')
      holdingRestored = holding.restored
      await cleanupFiles(cleanupPaths)
      return { outcome: 'failed', error: message.slice(0, 500), holdingRestored }
    }
  }

  private async showMedia(media: ObsPreparedMedia, token: number) {
    const scenes = this.sceneNames()
    const sources = this.sourceNames()
    await this.stopAndClearContent()
    if (!this.isCurrentGeneration(token)) return

    await this.setEnabled(scenes.content, sources.contentBg, true)
    await this.setEnabled(scenes.content, sources.text, false)
    await this.setEnabled(scenes.content, sources.image, false)
    await this.setEnabled(scenes.content, sources.video, false)

    if (media.kind === 'text' || media.kind === 'image') {
      const inputName = media.kind === 'text' ? sources.text : sources.image
      await this.client.call('SetInputSettings', {
        inputName,
        overlay: true,
        inputSettings: { file: media.filePath, unload: false },
      })
      await this.setEnabled(scenes.content, inputName, true)
      return
    }

    // Video: preload path, mute, restart, wait until PLAYING (readiness) before scene switch.
    await this.client.call('SetInputMute', { inputName: sources.video, inputMuted: true })
    await this.client.call('SetInputSettings', {
      inputName: sources.video,
      overlay: true,
      inputSettings: {
        is_local_file: true,
        local_file: media.filePath,
        looping: false,
        restart_on_activate: true,
        clear_on_media_end: false,
      },
    })
    await this.setEnabled(scenes.content, sources.video, true)
    await this.client.call('TriggerMediaInputAction', {
      inputName: sources.video,
      mediaAction: ObsMediaInputAction.RESTART,
    })
    await this.waitUntilMediaPlaying(sources.video, token)
  }

  private async waitUntilMediaPlaying(inputName: string, token: number) {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (!this.isCurrentGeneration(token)) return
      const status = await this.client.call('GetMediaInputStatus', { inputName })
      if (status.mediaState === ObsMediaState.ERROR) {
        throw new Error('OBS media input entered OBS_MEDIA_STATE_ERROR during preload')
      }
      if (status.mediaState === ObsMediaState.PLAYING) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('OBS media input did not reach OBS_MEDIA_STATE_PLAYING in time')
  }

  private waitForPresentation(media: ObsPreparedMedia, token: number, signal: AbortSignal): Promise<void> {
    if (media.kind === 'text' || media.kind === 'image') {
      return sleep(media.holdMs, signal).then(() => {
        if (!this.isCurrentGeneration(token)) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      })
    }
    return this.waitForVideoEnd(media.maxMs, token, signal)
  }

  private waitForVideoEnd(maxMs: number, token: number, signal: AbortSignal): Promise<void> {
    const sources = this.sourceNames()
    return new Promise((resolve, reject) => {
      let settled = false
      const hardenMs = Math.min(maxMs, this.cfg.maxVideoSeconds * 1000)

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort)
        this.client.off('MediaInputPlaybackEnded', onEnded)
        clearTimeout(hardTimer)
        clearInterval(pollTimer)
      }

      const settleOk = () => {
        if (settled) return
        if (!this.isCurrentGeneration(token)) {
          settleErr(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          return
        }
        settled = true
        cleanup()
        resolve()
      }

      const settleErr = (err: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      }

      const onAbort = () => settleErr(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      const onEnded = (payload: { inputName: string }) => {
        if (payload.inputName !== sources.video) return
        // Late events from a previous claim are ignored via generation token.
        if (!this.isCurrentGeneration(token)) return
        settleOk()
      }

      signal.addEventListener('abort', onAbort, { once: true })
      this.client.on('MediaInputPlaybackEnded', onEnded)

      // Hard cap even when MediaInputPlaybackEnded is missing.
      const hardTimer = setTimeout(() => settleOk(), hardenMs)

      // Poll for ENDED/ERROR as a backup to the event.
      const pollTimer = setInterval(() => {
        if (!this.isCurrentGeneration(token)) {
          settleErr(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          return
        }
        this.client.call('GetMediaInputStatus', { inputName: sources.video }).then((status) => {
          if (status.mediaState === ObsMediaState.ERROR) {
            settleErr(new Error('OBS media input entered OBS_MEDIA_STATE_ERROR during playback'))
          } else if (status.mediaState === ObsMediaState.ENDED || status.mediaState === ObsMediaState.STOPPED) {
            settleOk()
          }
        }).catch(() => {
          // ignore transient poll errors; hard timer still applies
        })
      }, 250)

      if (signal.aborted) onAbort()
    })
  }
}
