import { describe, expect, it } from 'vitest'
import { layoutText, measureEm, normalizeText, textBlockHeight, wrapText } from '../workers/broadcast/text-layout'
import { planFinish, planRecovery, retryDelayMs, type FinishInput } from '../workers/broadcast/transitions'
import { Compositor, NullSink } from '../workers/broadcast/output'
import { FrameSplitter, StillSource, type FrameSource } from '../workers/broadcast/frames'
import { loadConfig, redactSecrets } from '../workers/broadcast/config'

describe('text layout', () => {
  it('wraps on word boundaries and hard-breaks long words', () => {
    expect(wrapText('aaaa bbbb cc', measureEm('aaaa bbbb'))).toEqual(['aaaa bbbb', 'cc'])
    expect(wrapText('a'.repeat(12), measureEm('aaaaa'))).toEqual(['aaaaa', 'aaaaa', 'aa'])
  })

  it('treats capitals and wide glyphs as wider than lowercase', () => {
    expect(measureEm('WWWW')).toBeGreaterThan(measureEm('iiii') * 2)
    expect(wrapText('AAAA AAAA', 4).length).toBe(2)
  })

  it('keeps paragraph breaks and strips control characters', () => {
    expect(normalizeText('a\r\nb\u0007\n\n\n\nc')).toBe('a\nb\n\nc')
    expect(normalizeText('hi 👋🏽 there ❤️ 🇮🇳')).toBe('hi  there')
    expect(wrapText('one\n\ntwo', 20)).toEqual(['one', '', 'two'])
  })

  it('uses a large font for short text and a smaller one for long text', () => {
    const short = layoutText('Hello WrittenBoard!', 1152, 440)
    const long = layoutText('word '.repeat(100), 1152, 440)
    expect(short.fontSize).toBeGreaterThan(long.fontSize)
    expect(short.truncated).toBe(false)
  })

  it('fits the maximum 500-character submission without truncation', () => {
    const layout = layoutText('lorem ipsum dolor sit amet '.repeat(19).slice(0, 500), 1152, 440)
    expect(layout.truncated).toBe(false)
    expect(textBlockHeight(layout.lines.length, layout.fontSize, layout.lineSpacing)).toBeLessThanOrEqual(440)
    for (const line of layout.lines) expect(measureEm(line) * layout.fontSize).toBeLessThanOrEqual(1152)
  })

  it('fits 500 characters of all-caps text inside the frame width', () => {
    const layout = layoutText('SHOUTING TEXT '.repeat(36).slice(0, 500), 1152, 440)
    for (const line of layout.lines) expect(measureEm(line) * layout.fontSize).toBeLessThanOrEqual(1152)
    expect(textBlockHeight(layout.lines.length, layout.fontSize, layout.lineSpacing)).toBeLessThanOrEqual(440)
  })

  it('truncates with an ellipsis when text cannot fit', () => {
    const layout = layoutText('x'.repeat(5000), 1152, 440)
    expect(layout.truncated).toBe(true)
    expect(layout.lines.at(-1)?.endsWith('…')).toBe(true)
  })
})

const base: FinishInput = {
  outcome: 'completed',
  mode: 'rtmp',
  claimId: 'c1',
  maxAttempts: 3,
  now: 1_000_000,
  queue: { exists: true, status: 'playing', claimId: 'c1', attempts: 1 },
  submission: { exists: true, status: 'approved' },
}

describe('finish transitions', () => {
  it('marks an approved item broadcast after an rtmp play', () => {
    const plan = planFinish(base)
    expect(plan.owned).toBe(true)
    expect(plan.queueUpdate).toMatchObject({ status: 'played', result: 'broadcast', claimId: null })
    expect(plan.submissionUpdate).toMatchObject({ status: 'broadcast' })
  })

  it('never resurrects a submission revoked while on air', () => {
    const plan = planFinish({ ...base, submission: { exists: true, status: 'revoked' } })
    expect(plan.submissionUpdate).toBeNull()
  })

  it('writes nothing when the queue entry was cancelled during play', () => {
    const plan = planFinish({ ...base, queue: { ...base.queue, status: 'cancelled' } })
    expect(plan).toMatchObject({ owned: false, queueUpdate: null, submissionUpdate: null })
  })

  it('writes nothing when another claim owns the item', () => {
    expect(planFinish({ ...base, queue: { ...base.queue, claimId: 'other' } }).owned).toBe(false)
  })

  it('cancels instead of failing when the submission is no longer approved', () => {
    const plan = planFinish({ ...base, outcome: 'cancelled', submission: { exists: true, status: 'rejected' } })
    expect(plan.queueUpdate).toMatchObject({ status: 'cancelled' })
    expect(plan.submissionUpdate).toBeNull()
  })

  it('retries failures with backoff, then gives up', () => {
    const retry = planFinish({ ...base, outcome: 'failed', error: 'boom' })
    expect(retry.queueUpdate).toMatchObject({ status: 'queued', lastError: 'boom', notBefore: base.now + retryDelayMs(1) })
    const final = planFinish({ ...base, outcome: 'failed', queue: { ...base.queue, attempts: 3 } })
    expect(final.queueUpdate).toMatchObject({ status: 'failed' })
    expect(final.submissionUpdate).toMatchObject({ lastBroadcastResult: 'failed' })
    expect(final.submissionUpdate).not.toHaveProperty('status')
  })

  it('does not retry an item whose submission was revoked', () => {
    const plan = planFinish({ ...base, outcome: 'failed', submission: { exists: true, status: 'revoked' } })
    expect(plan.queueUpdate).toMatchObject({ status: 'failed' })
    expect(plan.submissionUpdate).toBeNull()
  })

  it('requeues interrupted items without using up an attempt', () => {
    const plan = planFinish({ ...base, outcome: 'interrupted', queue: { ...base.queue, attempts: 2 } })
    expect(plan.queueUpdate).toMatchObject({ status: 'queued', attempts: 1 })
    expect(plan.aired).toBe(false)
  })

  it('records skips and dry-runs distinctly from real broadcasts', () => {
    expect(planFinish({ ...base, outcome: 'skipped' }).submissionUpdate).toMatchObject({ status: 'skipped' })
    expect(planFinish({ ...base, mode: 'dry-run' }).submissionUpdate).toMatchObject({ status: 'broadcast_dry_run' })
    expect(planFinish({ ...base, mode: 'record' }).submissionUpdate).not.toHaveProperty('status')
  })

  it('recovers crashed items with bounded retries', () => {
    expect(planRecovery(1, 3)).toMatchObject({ status: 'queued', claimId: null })
    expect(planRecovery(3, 3)).toMatchObject({ status: 'failed' })
  })
})

describe('compositor', () => {
  const slate = Buffer.from('slate')

  it('airs the source, then returns to the slate and resolves ended', async () => {
    const c = new Compositor(30, new NullSink(), slate)
    const frame = Buffer.from('item')
    const done = c.play(new StillSource(frame, 2), new AbortController().signal)
    expect(c.produceFrame()).toBe(frame)
    expect(c.produceFrame()).toBe(frame)
    expect(c.produceFrame()).toBe(slate)
    await expect(done).resolves.toBe('ended')
    expect(c.onAir).toBe(false)
  })

  it('takes an item off air immediately on abort and stops its source', async () => {
    const c = new Compositor(30, new NullSink(), slate)
    let stopped = false
    const source: FrameSource = { error: null, nextFrame: () => Buffer.from('v'), stop: () => { stopped = true } }
    const ac = new AbortController()
    const done = c.play(source, ac.signal)
    c.produceFrame()
    ac.abort('skipped')
    await expect(done).resolves.toBe('aborted')
    expect(stopped).toBe(true)
    expect(c.produceFrame()).toBe(slate)
  })

  it('keeps emitting frames at the configured rate', async () => {
    const sink = new NullSink()
    const c = new Compositor(50, sink, slate)
    c.start()
    await new Promise((r) => setTimeout(r, 400))
    c.stop()
    // ~20 expected at 50fps; loose bounds so slow CI runners do not flake
    expect(sink.frames).toBeGreaterThanOrEqual(10)
    expect(sink.frames).toBeLessThanOrEqual(30)
  })
})

describe('frame splitter', () => {
  it('reassembles frames across arbitrary chunk boundaries', () => {
    const s = new FrameSplitter(4)
    expect(s.push(Buffer.from('ab'))).toEqual([])
    const frames = s.push(Buffer.from('cdefghij'))
    expect(frames.map(String)).toEqual(['abcd', 'efgh'])
    expect(s.push(Buffer.from('kl')).map(String)).toEqual(['ijkl'])
  })
})

describe('config', () => {
  it('defaults to dry-run and requires a stream key for rtmp', () => {
    expect(loadConfig({}).mode).toBe('dry-run')
    expect(() => loadConfig({ BROADCAST_MODE: 'rtmp' })).toThrow(/YOUTUBE_STREAM_KEY/)
    expect(() => loadConfig({ BROADCAST_MODE: 'live' })).toThrow(/Unknown/)
  })

  it('keeps the stream key out of logs', () => {
    const cfg = loadConfig({ BROADCAST_MODE: 'rtmp', YOUTUBE_STREAM_KEY: 'abcd-1234' })
    expect(cfg.outputTarget).toBe('rtmp://a.rtmp.youtube.com/live2/abcd-1234')
    expect(redactSecrets(`failed to connect ${cfg.outputTarget}`, cfg.redact)).not.toContain('abcd-1234')
  })
})
