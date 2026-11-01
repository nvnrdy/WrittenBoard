'use client'
import { useEffect, useState } from 'react'
import { firebaseClient } from '@/lib/firebase/client'
import { initAppCheck } from '@/lib/firebase/app-check'
import { AppHeader } from '@/components/app-shell/AppHeader'
import '@/components/app-shell/app-shell.css'

type Item = Record<string, unknown> & { id: string; type?: string; displayName?: string; contentText?: string; durationSeconds?: number | null; mediaReviewedAt?: string | null; status?: string; submissionId?: string; reason?: string; details?: string }

type ConfirmState = {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
}

export default function AdminClient({
  role,
  pending,
  queue,
  reports,
}: {
  user: { uid: string; email?: string | null }
  role: string
  pending: Item[]
  queue: Item[]
  reports: Item[]
}) {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Item | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState('')
  const [panel, setPanel] = useState<'review' | 'notes'>('review')

  useEffect(() => { void initAppCheck() }, [])

  async function call(path: string, body: Record<string, unknown>) {
    const token = await firebaseClient().auth.currentUser?.getIdToken()
    if (!token) throw new Error('Sign in again to continue')
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || 'Request failed')
    return j
  }

  function openAct(id: string, action: 'approve' | 'reject' | 'revoke' | 'mark_media_reviewed', item?: Item) {
    setSelected(item || pending.find((p) => p.id === id) || null)
    setReason('')
    setDuration(item?.durationSeconds != null ? String(item.durationSeconds) : '')
    setPanel('notes')
    setConfirm({
      title: actionLabel(action),
      body: actionBody(action),
      confirmLabel: actionLabel(action),
      danger: action === 'reject' || action === 'revoke',
      onConfirm: async () => {
        const body: Record<string, unknown> = { submission_id: id, action, reason: reason.trim() }
        if (action === 'mark_media_reviewed' && item?.type === 'video' && item.durationSeconds == null) {
          const durationSeconds = Number(duration)
          if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 15) {
            throw new Error('Duration must be a number between 0 and 15')
          }
          body.durationSeconds = durationSeconds
        }
        setBusy(id)
        setMessage('')
        try {
          await call('/api/moderation/review', body)
          location.reload()
        } finally {
          setBusy('')
        }
      },
    })
  }

  async function preview(item: Item) {
    setBusy(item.id)
    setMessage('')
    setPreviewUrl(null)
    setPanel('review')
    try {
      const j = await call('/api/moderation/preview', { submission_id: item.id })
      setSelected({ ...item, preview: j })
      if (j.previewUrl) setPreviewUrl(j.previewUrl)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy('')
    }
  }

  function askEmergency(action: string) {
    setConfirm({
      title: `Confirm ${action.replace(/_/g, ' ')}`,
      body: 'This writes an emergency control the broadcast worker will apply on its next poll.',
      confirmLabel: 'Confirm',
      danger: action !== 'resume_ugc',
      onConfirm: async () => {
        setBusy(action)
        try {
          await call('/api/broadcast/emergency', { action })
          setMessage(`${action} saved. The broadcast worker will apply it on the next poll.`)
        } finally {
          setBusy('')
        }
      },
    })
  }

  async function resolveReport(id: string, status: 'resolved' | 'dismissed') {
    setBusy(id)
    try {
      await call(`/api/reports/${id}`, { status })
      location.reload()
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Could not update report')
    } finally {
      setBusy('')
    }
  }

  function askCleanup() {
    setConfirm({
      title: 'Run media cleanup',
      body: 'Deletes rejected/revoked media older than 30 days and abandoned pending uploads older than 24 hours.',
      confirmLabel: 'Run cleanup',
      onConfirm: async () => {
        setBusy('cleanup')
        try {
          const j = await call('/api/cleanup/media', {})
          setMessage(`Cleanup removed ${j.deletedObjects} objects.`)
        } finally {
          setBusy('')
        }
      },
    })
  }

  async function runConfirm() {
    if (!confirm) return
    try {
      await confirm.onConfirm()
      setConfirm(null)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Action failed')
    }
  }

  return (
    <div className="wa">
      <AppHeader signedIn isStaff />
      <main className="wa-main">
        <div className="wa-row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 32 }}>Ops console</h1>
            <p className="wa-lead">Signed in as {role}. Media stays private until you preview and approve.</p>
          </div>
          <div className="wa-row">
            <button type="button" className="wa-btn" disabled={!!busy} onClick={() => askEmergency('skip_current')}>Skip current</button>
            <button type="button" className="wa-btn wa-btn-danger" disabled={!!busy} onClick={() => askEmergency('pause_ugc')}>Pause UGC</button>
            <button type="button" className="wa-btn wa-btn-ok" disabled={!!busy} onClick={() => askEmergency('resume_ugc')}>Resume UGC</button>
            <button type="button" className="wa-btn" disabled={!!busy} onClick={askCleanup}>Cleanup</button>
          </div>
        </div>
        {message && <p role="status" className="wa-status">{message}</p>}

        <div className="wa-grid-2" style={{ marginTop: 20 }}>
          <section>
            <div className="wa-card">
              <h2 style={{ margin: 0, fontSize: 20 }}>Pending moderation ({pending.length})</h2>
              <p className="wa-muted">Automated image/video checks are fail-closed — every media item needs a human review.</p>
              <div className="wa-list">
                {pending.map((s) => (
                  <div key={s.id} className="wa-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div className="wa-row" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <b>{s.type}</b> by @{String(s.displayName || 'unknown')}
                        <div className="wa-muted">{s.contentText?.slice(0, 140)}</div>
                        {s.type !== 'text' && (
                          <div className="wa-muted">
                            duration: {s.durationSeconds ?? 'n/a'} · media reviewed: {s.mediaReviewedAt ? 'yes' : 'no'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="wa-row">
                      <button type="button" className="wa-btn" disabled={!!busy} onClick={() => preview(s)}>Preview</button>
                      {s.type !== 'text' && (
                        <button type="button" className="wa-btn" disabled={!!busy} onClick={() => openAct(s.id, 'mark_media_reviewed', s)}>Mark reviewed</button>
                      )}
                      <button type="button" className="wa-btn wa-btn-ok" disabled={!!busy} onClick={() => openAct(s.id, 'approve', s)}>Approve</button>
                      <button type="button" className="wa-btn wa-btn-danger" disabled={!!busy} onClick={() => openAct(s.id, 'reject', s)}>Reject</button>
                    </div>
                  </div>
                ))}
                {pending.length === 0 && <p className="wa-muted">No pending items.</p>}
              </div>
            </div>

            <div className="wa-card" style={{ marginTop: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Open reports ({reports.length})</h2>
              <div className="wa-list">
                {reports.map((r) => (
                  <div key={r.id} className="wa-item">
                    <div>
                      <b>{String(r.reason)}</b> on {String(r.submissionId)}
                      <div className="wa-muted">{String(r.details || 'No details')}</div>
                    </div>
                    <div className="wa-row">
                      <button type="button" className="wa-btn wa-btn-ok" disabled={!!busy} onClick={() => resolveReport(r.id, 'resolved')}>Resolve</button>
                      <button type="button" className="wa-btn" disabled={!!busy} onClick={() => resolveReport(r.id, 'dismissed')}>Dismiss</button>
                    </div>
                  </div>
                ))}
                {reports.length === 0 && <p className="wa-muted">No open reports.</p>}
              </div>
            </div>
          </section>

          <aside>
            <div className="wa-card">
              <h2 style={{ margin: 0, fontSize: 20 }}>Broadcast queue</h2>
              <div className="wa-list">
                {queue.map((q) => (
                  <div key={q.id} className="wa-item" style={{ fontSize: 13 }}>
                    <span>{String(q.type || q.submissionId)} — @{String(q.displayName || '')}</span>
                    <span className="wa-muted">{String(q.status)}</span>
                  </div>
                ))}
                {queue.length === 0 && <p className="wa-muted">Queue is empty.</p>}
              </div>
            </div>

            {selected && (
              <div className="wa-card" style={{ marginTop: 16 }}>
                <div className="wa-row" style={{ justifyContent: 'space-between' }}>
                  <h2 style={{ margin: 0, fontSize: 20 }}>Review panel</h2>
                  <button type="button" className="wa-btn" onClick={() => { setSelected(null); setPreviewUrl(null); setConfirm(null); setPanel('review') }}>Close</button>
                </div>
                {panel === 'review' && (
                  <>
                    {previewUrl && selected.type === 'image' && <img src={previewUrl} alt="Submission preview" className="wa-preview" />}
                    {previewUrl && selected.type === 'video' && <video src={previewUrl} controls className="wa-preview" />}
                    {selected.type === 'text' && <p style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{String(selected.contentText || '')}</p>}
                    <p className="wa-muted" style={{ marginTop: 12 }}>
                      {selected.id} · {String(selected.status || '')} · duration {selected.durationSeconds ?? 'n/a'}
                    </p>
                  </>
                )}
                {panel === 'notes' && confirm && (
                  <div style={{ marginTop: 12 }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{confirm.title}</h3>
                    <p className="wa-muted">{confirm.body}</p>
                    <div className="wa-field">
                      <label htmlFor="reason">Notes / reason</label>
                      <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Optional for approve; recommended for reject" />
                    </div>
                    {confirm.title.includes('Mark media') && selected?.type === 'video' && selected.durationSeconds == null && (
                      <div className="wa-field">
                        <label htmlFor="duration">Verified duration (seconds, max 15)</label>
                        <input id="duration" type="number" min={0.1} max={15} step={0.1} value={duration} onChange={(e) => setDuration(e.target.value)} />
                      </div>
                    )}
                    <div className="wa-row">
                      <button type="button" className="wa-btn" onClick={() => { setConfirm(null); setPanel('review') }}>Cancel</button>
                      <button type="button" className={`wa-btn ${confirm.danger ? 'wa-btn-danger' : 'wa-btn-ok'}`} disabled={!!busy} onClick={runConfirm}>
                        {confirm.confirmLabel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>

        {confirm && !selected && (
          <div className="wa-card" style={{ marginTop: 16, maxWidth: 480 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{confirm.title}</h2>
            <p className="wa-lead">{confirm.body}</p>
            <div className="wa-row" style={{ marginTop: 12 }}>
              <button type="button" className="wa-btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className={`wa-btn ${confirm.danger ? 'wa-btn-danger' : 'wa-btn-primary'}`} disabled={!!busy} onClick={runConfirm}>
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function actionLabel(action: string) {
  if (action === 'approve') return 'Approve'
  if (action === 'reject') return 'Reject'
  if (action === 'revoke') return 'Revoke'
  return 'Mark media reviewed'
}

function actionBody(action: string) {
  if (action === 'approve') return 'Approved items enter the broadcast queue. Confirm you reviewed the content.'
  if (action === 'reject') return 'Rejected submissions will not air. Media is retained until the cleanup job runs.'
  if (action === 'mark_media_reviewed') return 'Confirm you watched/viewed the media. Videos without a stored duration need a verified length.'
  return 'Confirm this action.'
}
