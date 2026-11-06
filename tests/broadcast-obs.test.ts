import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { FakeFirestore } from './helpers/fake-firestore'
import { loadConfig, parseObsWebsocketUrl, redactSecrets, type WorkerConfig } from '../workers/broadcast/config'
import { planFinish, type FinishInput } from '../workers/broadcast/transitions'
import { gateObsCompletion, playItemObs, type ObsPlayerDeps } from '../workers/broadcast/player'
import { ObsPresenter } from '../workers/broadcast/obs/presenter'
import type { ObsClient, ObsCall } from '../workers/broadcast/obs/client'
import { ObsMediaInputAction, ObsMediaState, DEFAULT_OBS_SCENES, DEFAULT_OBS_SOURCES } from '../workers/broadcast/obs/constants'
import type { ClaimedItem } from '../workers/broadcast/queue'
import * as obsMedia from '../workers/broadcast/obs/media'

const silent = () => undefined
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type CallLog = { type: string; data?: unknown }

class MockObsClient extends EventEmitter implements ObsClient {
  connected = false
  calls: CallLog[] = []
  programScene: string = DEFAULT_OBS_SCENES.holding
  mediaState: string = ObsMediaState.STOPPED
  failConnect = false
  failCalls = new Set<string>()
  inputSettings: Record<string, Record<string, unknown>> = {}
  enabled: Record<string, boolean> = {}
  private endedTimers: NodeJS.Timeout[] = []

  async connect(_url: string, _password: string) {
    if (this.failConnect) throw new Error('auth failed')
    this.connected = true
  }

  async disconnect() {
    this.connected = false
  }

  call: ObsCall = async (requestType, requestData) => {
    this.calls.push({ type: requestType, data: requestData })
    if (!this.connected) throw new Error('OBS WebSocket is not connected')
    if (this.failCalls.has(requestType)) throw new Error(`${requestType} failed`)

    switch (requestType) {
      case 'GetSceneList':
        return {
          currentProgramSceneName: this.programScene,
          currentProgramSceneUuid: 'u',
          currentPreviewSceneName: null,
          currentPreviewSceneUuid: null,
          scenes: [
            { sceneName: DEFAULT_OBS_SCENES.holding, sceneIndex: 0 },
            { sceneName: DEFAULT_OBS_SCENES.content, sceneIndex: 1 },
          ],
        } as never
      case 'GetSceneItemList': {
        const sceneName = (requestData as { sceneName?: string })?.sceneName
        const items =
          sceneName === DEFAULT_OBS_SCENES.holding
            ? [{ sceneItemId: 1, sourceName: DEFAULT_OBS_SOURCES.holdingBg, sceneItemEnabled: true }]
            : [
                { sceneItemId: 10, sourceName: DEFAULT_OBS_SOURCES.contentBg, sceneItemEnabled: true },
                { sceneItemId: 11, sourceName: DEFAULT_OBS_SOURCES.text, sceneItemEnabled: false },
                { sceneItemId: 12, sourceName: DEFAULT_OBS_SOURCES.image, sceneItemEnabled: false },
                { sceneItemId: 13, sourceName: DEFAULT_OBS_SOURCES.video, sceneItemEnabled: false },
              ]
        return { sceneItems: items } as never
      }
      case 'SetCurrentProgramScene': {
        const name = (requestData as { sceneName?: string })?.sceneName
        if (name) this.programScene = name
        return undefined as never
      }
      case 'GetCurrentProgramScene':
        return {
          sceneName: this.programScene,
          sceneUuid: 'u',
          currentProgramSceneName: this.programScene,
          currentProgramSceneUuid: 'u',
        } as never
      case 'SetSceneItemEnabled': {
        const d = requestData as { sceneItemId: number; sceneItemEnabled: boolean }
        this.enabled[String(d.sceneItemId)] = d.sceneItemEnabled
        return undefined as never
      }
      case 'SetInputSettings': {
        const d = requestData as { inputName?: string; inputSettings: Record<string, unknown> }
        if (d.inputName) this.inputSettings[d.inputName] = { ...d.inputSettings }
        return undefined as never
      }
      case 'SetInputMute':
        return undefined as never
      case 'TriggerMediaInputAction': {
        const d = requestData as { inputName?: string; mediaAction: string }
        if (d.mediaAction === ObsMediaInputAction.RESTART) {
          this.mediaState = ObsMediaState.PLAYING
        }
        if (d.mediaAction === ObsMediaInputAction.STOP) {
          this.mediaState = ObsMediaState.STOPPED
        }
        return undefined as never
      }
      case 'GetMediaInputStatus':
        return {
          mediaState: this.mediaState,
          mediaDuration: 5000,
          mediaCursor: 0,
        } as never
      default:
        return undefined as never
    }
  }

  /** Simulate MediaInputPlaybackEnded for WB Video after delay. */
  emitVideoEnded(afterMs = 20) {
    const t = setTimeout(() => {
      this.emit('MediaInputPlaybackEnded', { inputName: DEFAULT_OBS_SOURCES.video, inputUuid: 'v' })
      this.mediaState = ObsMediaState.ENDED
    }, afterMs)
    this.endedTimers.push(t)
  }

  simulateDisconnect() {
    this.connected = false
    this.emit('ConnectionClosed', new Error('closed'))
  }

  clearTimers() {
    for (const t of this.endedTimers) clearTimeout(t)
    this.endedTimers = []
  }
}

function claimed(partial: Partial<ClaimedItem> = {}): ClaimedItem {
  return {
    id: 'q1',
    claimId: 'claim-1',
    submissionId: 's1',
    userId: 'u1',
    type: 'text',
    displayName: 'TestUser',
    contentText: 'hello obs',
    storagePath: null,
    mimeType: null,
    durationSeconds: null,
    attempts: 1,
    ...partial,
  }
}

describe('OBS config + transitions', () => {
  it('loads obs mode with localhost WebSocket and redacts the password', () => {
    const cfg = loadConfig({
      BROADCAST_MODE: 'obs',
      OBS_WEBSOCKET_PASSWORD: 'super-secret-obs',
      BROADCAST_WORK_DIR: 'D:\\tmp\\wb-obs',
    })
    expect(cfg.mode).toBe('obs')
    expect(cfg.outputTarget).toBeNull()
    expect(cfg.obs?.websocketUrl).toBe('ws://127.0.0.1:4455')
    expect(cfg.obs?.password).toBe('super-secret-obs')
    expect(cfg.redact).toContain('super-secret-obs')
    expect(redactSecrets('auth with super-secret-obs failed', cfg.redact)).not.toContain('super-secret-obs')
  })

  it('refuses YouTube stream key and RTMP URL in obs mode', () => {
    expect(() => loadConfig({
      BROADCAST_MODE: 'obs',
      OBS_WEBSOCKET_PASSWORD: 'x',
      YOUTUBE_STREAM_KEY: 'abc',
    })).toThrow(/YOUTUBE_STREAM_KEY/)
    expect(() => loadConfig({
      BROADCAST_MODE: 'obs',
      OBS_WEBSOCKET_PASSWORD: 'x',
      BROADCAST_RTMP_URL: 'rtmp://a.rtmp.youtube.com/live2',
    })).toThrow(/BROADCAST_RTMP_URL/)
  })

  it('requires password and rejects non-loopback OBS URLs', () => {
    expect(() => loadConfig({ BROADCAST_MODE: 'obs' })).toThrow(/OBS_WEBSOCKET_PASSWORD/)
    expect(() => parseObsWebsocketUrl('ws://192.168.1.5:4455')).toThrow(/127\.0\.0\.1|localhost/)
    expect(() => parseObsWebsocketUrl('ws://127.0.0.1:4456')).toThrow(/4455/)
    expect(parseObsWebsocketUrl('ws://localhost:4455')).toBe('ws://127.0.0.1:4455')
  })

  it('writes played_obs without setting submission status to broadcast', () => {
    const base: FinishInput = {
      outcome: 'completed',
      mode: 'obs',
      claimId: 'c1',
      maxAttempts: 3,
      now: 1,
      queue: { exists: true, status: 'playing', claimId: 'c1', attempts: 1 },
      submission: { exists: true, status: 'approved' },
    }
    const plan = planFinish(base)
    expect(plan.queueUpdate).toMatchObject({ status: 'played', result: 'played_obs' })
    expect(plan.submissionUpdate).toMatchObject({ lastBroadcastResult: 'played_obs' })
    expect(plan.submissionUpdate).not.toHaveProperty('status')
  })

  it('gates obs completion when presenter is unhealthy', () => {
    expect(gateObsCompletion('obs', false, 'disconnected')).toEqual({
      outcome: 'failed',
      error: 'disconnected',
    })
    expect(gateObsCompletion('obs', true, null)).toBeNull()
    expect(gateObsCompletion('record', false, 'x')).toBeNull()
  })
})

describe('ObsPresenter with mock client', () => {
  let client: MockObsClient
  let workDir: string
  let cfg: WorkerConfig
  let prepareSpy: { mockRestore: () => void } | undefined

  beforeEach(() => {
    client = new MockObsClient()
    workDir = mkdtempSync(path.join(tmpdir(), 'wb-obs-'))
    cfg = loadConfig({
      BROADCAST_MODE: 'obs',
      OBS_WEBSOCKET_PASSWORD: 'test-pass',
      BROADCAST_HOLD_MS: '1000',
      BROADCAST_WORK_DIR: workDir,
    })
    prepareSpy = vi.spyOn(obsMedia, 'prepareObsMedia').mockImplementation(async (_cfg, item) => {
      const filePath = path.join(workDir, `mock-${item.claimId}.bin`)
      writeFileSync(filePath, 'x')
      if (item.type === 'video') {
        return { media: { kind: 'video', filePath, maxMs: 80 }, cleanupPaths: [filePath] }
      }
      if (item.type === 'image') {
        return { media: { kind: 'image', filePath, holdMs: 40 }, cleanupPaths: [filePath] }
      }
      return { media: { kind: 'text', filePath, holdMs: 40 }, cleanupPaths: [filePath] }
    })
  })

  afterEach(() => {
    client?.clearTimers()
    prepareSpy?.mockRestore()
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  async function readyPresenter() {
    await client.connect('ws://127.0.0.1:4455', 'test-pass')
    const presenter = new ObsPresenter(client, cfg, silent)
    await presenter.startup()
    return presenter
  }

  it('startup verifies scenes/sources and parks on Holding', async () => {
    const presenter = await readyPresenter()
    expect(presenter.ok()).toBe(true)
    expect(client.programScene).toBe(DEFAULT_OBS_SCENES.holding)
    expect(client.calls.some((c) => c.type === 'SetInputMute')).toBe(true)
    // Content media paths cleared at startup.
    expect(client.inputSettings[DEFAULT_OBS_SOURCES.video]?.local_file).toBe('')
  })

  it('fails closed when required scenes are missing', async () => {
    await client.connect('ws://127.0.0.1:4455', 'x')
    const bad = new MockObsClient()
    bad.connected = true
    bad.call = async (requestType) => {
      if (requestType === 'GetSceneList') {
        return {
          currentProgramSceneName: 'Other',
          currentProgramSceneUuid: 'u',
          currentPreviewSceneName: null,
          currentPreviewSceneUuid: null,
          scenes: [{ sceneName: 'Other', sceneIndex: 0 }],
        } as never
      }
      throw new Error(`unexpected ${requestType}`)
    }
    const presenter = new ObsPresenter(bad, cfg, silent)
    await expect(presenter.startup()).rejects.toThrow(/WB Holding/)
  })

  it('presents text then returns to Holding with cleared sources', async () => {
    const presenter = await readyPresenter()
    const result = await presenter.present(claimed(), { file: () => ({ createReadStream: () => Readable.from([]) }) }, new AbortController().signal)
    expect(result.outcome).toBe('completed')
    expect(result.holdingRestored).toBe(true)
    expect(client.programScene).toBe(DEFAULT_OBS_SCENES.holding)
    expect(client.inputSettings[DEFAULT_OBS_SOURCES.text]?.file).toBe('')
    expect(client.calls.some((c) => c.type === 'SetCurrentProgramScene' && (c.data as { sceneName: string }).sceneName === DEFAULT_OBS_SCENES.content)).toBe(true)
  })

  it('ignores late MediaInputPlaybackEnded from a prior generation', async () => {
    const presenter = await readyPresenter()
    const ac = new AbortController()

    // First video presentation: end event will fire late after abort.
    const first = presenter.present(
      claimed({ type: 'video', claimId: 'claim-a', storagePath: 'a', mimeType: 'video/mp4' }),
      { file: () => ({ createReadStream: () => Readable.from([]) }) },
      ac.signal,
    )
    await sleep(10)
    ac.abort('skipped')
    const firstResult = await first
    expect(firstResult.outcome).toBe('skipped')

    // Emit a stale ended event for the previous claim.
    client.emit('MediaInputPlaybackEnded', { inputName: DEFAULT_OBS_SOURCES.video, inputUuid: 'v' })

    const second = await presenter.present(
      claimed({ type: 'text', claimId: 'claim-b', contentText: 'next' }),
      { file: () => ({ createReadStream: () => Readable.from([]) }) },
      new AbortController().signal,
    )
    expect(second.outcome).toBe('completed')
  })

  it('does not claim Holding restored after disconnect', async () => {
    const presenter = await readyPresenter()
    client.simulateDisconnect()
    const holding = await presenter.attemptHolding('test')
    expect(holding.restored).toBe(false)
    expect(holding.ok).toBe(false)
    expect(holding.reason).toMatch(/disconnected/i)
  })

  it('aborts presentation and attempts Holding', async () => {
    const presenter = await readyPresenter()
    const ac = new AbortController()
    const playing = presenter.present(claimed(), { file: () => ({ createReadStream: () => Readable.from([]) }) }, ac.signal)
    await sleep(5)
    ac.abort('cancelled')
    const result = await playing
    expect(result.outcome).toBe('cancelled')
    expect(result.holdingRestored).toBe(true)
    expect(client.programScene).toBe(DEFAULT_OBS_SCENES.holding)
  })

  it('fails closed when Content scene cannot be confirmed', async () => {
    const presenter = await readyPresenter()
    const original = client.call
    client.call = async (requestType, requestData) => {
      if (requestType === 'GetCurrentProgramScene') {
        // Lie after SetCurrentProgramScene to Content.
        if (client.programScene === DEFAULT_OBS_SCENES.content) {
          return {
            sceneName: 'Wrong',
            sceneUuid: 'u',
            currentProgramSceneName: 'Wrong',
            currentProgramSceneUuid: 'u',
          } as never
        }
      }
      return original(requestType, requestData)
    }
    const result = await presenter.present(claimed(), { file: () => ({ createReadStream: () => Readable.from([]) }) }, new AbortController().signal)
    expect(result.outcome).toBe('failed')
    expect(result.error).toMatch(/Content scene not confirmed/)
  })

  it('caps video wait and completes without MediaInputPlaybackEnded', async () => {
    const presenter = await readyPresenter()
    // Do not emit ended — hard timer must complete.
    const result = await presenter.present(
      claimed({ type: 'video', storagePath: 'v', mimeType: 'video/mp4', durationSeconds: 20 }),
      { file: () => ({ createReadStream: () => Readable.from([]) }) },
      new AbortController().signal,
    )
    expect(result.outcome).toBe('completed')
    expect(prepareSpy).toHaveBeenCalled()
    // Restart + mute used for video.
    expect(client.calls.some((c) => c.type === 'TriggerMediaInputAction' && (c.data as { mediaAction: string }).mediaAction === ObsMediaInputAction.RESTART)).toBe(true)
  })

  it('clears content file paths on cleanup so stale media cannot linger', async () => {
    const presenter = await readyPresenter()
    await presenter.present(claimed({ type: 'image', storagePath: 'i', mimeType: 'image/png' }), { file: () => ({ createReadStream: () => Readable.from([]) }) }, new AbortController().signal)
    expect(client.inputSettings[DEFAULT_OBS_SOURCES.image]?.file).toBe('')
    expect(client.inputSettings[DEFAULT_OBS_SOURCES.video]?.local_file).toBe('')
  })
})

describe('playItemObs watches + gate', () => {
  let fake: FakeFirestore
  let db: Firestore
  let workDir: string
  let cfg: WorkerConfig
  let client: MockObsClient
  let prepareSpy: { mockRestore: () => void } | undefined

  beforeEach(() => {
    fake = new FakeFirestore()
    db = fake as unknown as Firestore
    workDir = mkdtempSync(path.join(tmpdir(), 'wb-obs-flow-'))
    cfg = loadConfig({
      BROADCAST_MODE: 'obs',
      OBS_WEBSOCKET_PASSWORD: 'test-pass',
      BROADCAST_HOLD_MS: '1000',
      BROADCAST_WORK_DIR: workDir,
    })
    client = new MockObsClient()
    prepareSpy = vi.spyOn(obsMedia, 'prepareObsMedia').mockImplementation(async (_cfg, item) => {
      const filePath = path.join(workDir, `mock-${item.claimId}.bin`)
      writeFileSync(filePath, 'x')
      return { media: { kind: 'text', filePath, holdMs: 60 }, cleanupPaths: [filePath] }
    })
  })

  afterEach(() => {
    prepareSpy?.mockRestore()
    client?.clearTimers()
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  async function deps(): Promise<{ deps: ObsPlayerDeps; presenter: ObsPresenter; item: ClaimedItem }> {
    await fake.collection('submissions').doc('s1').set({
      id: 's1', userId: 'u1', displayName: 'X', type: 'text', contentText: 'hi', status: 'approved',
    })
    await fake.collection('broadcast_queue').doc('s1').set({
      submissionId: 's1', userId: 'u1', type: 'text', status: 'playing', claimId: 'claim-1',
      createdAt: Timestamp.now(),
    })
    await fake.collection('system').doc('settings').set({ skipToken: 'tok-1' })
    await client.connect('ws://127.0.0.1:4455', 'test-pass')
    const presenter = new ObsPresenter(client, cfg, silent)
    await presenter.startup()
    const item = claimed({ id: 's1', submissionId: 's1', claimId: 'claim-1' })
    return {
      presenter,
      item,
      deps: {
        cfg,
        db,
        bucket: () => ({ file: () => ({ createReadStream: () => Readable.from([Buffer.from('x')]) }) }),
        presenter,
        log: silent,
        onAir: async () => undefined,
        obsOk: () => presenter.ok(),
        obsError: () => presenter.lastObsError,
      },
    }
  }

  it('completes an approved item via OBS watches path', async () => {
    const ctx = await deps()
    const { outcome } = await playItemObs(ctx.deps, ctx.item, 'tok-1', new AbortController().signal)
    expect(outcome).toBe('completed')
  })

  it('aborts on revoke while presenting', async () => {
    const ctx = await deps()
    const playing = playItemObs(ctx.deps, ctx.item, 'tok-1', new AbortController().signal)
    await sleep(15)
    await fake.collection('submissions').doc('s1').update({ status: 'revoked' })
    const { outcome } = await playing
    expect(outcome).toBe('cancelled')
  })

  it('aborts on skip token change', async () => {
    const ctx = await deps()
    const playing = playItemObs(ctx.deps, ctx.item, 'tok-1', new AbortController().signal)
    await sleep(15)
    await fake.collection('system').doc('settings').update({ skipToken: 'tok-2' })
    const { outcome } = await playing
    expect(outcome).toBe('skipped')
  })

  it('refuses completed when obsOk is false after present', async () => {
    const ctx = await deps()
    ctx.deps.obsOk = () => false
    ctx.deps.obsError = () => 'OBS presenter is not available'
    // Force present to succeed by keeping real ok during present — gate after uses obsOk().
    // Spy present to return completed while gate fails.
    vi.spyOn(ctx.presenter, 'present').mockResolvedValue({
      outcome: 'completed',
      error: null,
      holdingRestored: true,
    })
    const { outcome, error } = await playItemObs(ctx.deps, ctx.item, 'tok-1', new AbortController().signal)
    expect(outcome).toBe('failed')
    expect(error).toMatch(/not available/)
  })
})
