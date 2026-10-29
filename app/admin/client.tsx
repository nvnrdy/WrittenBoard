'use client'
import { useState } from 'react'
import { firebaseClient } from '@/lib/firebase/client'

type Item = Record<string, any>

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

  async function act(id: string, action: 'approve' | 'reject' | 'revoke' | 'mark_media_reviewed', item?: Item) {
    const reason = window.prompt(`Reason / notes for ${action}?`) || ''
    const body: Record<string, unknown> = { submission_id: id, action, reason }
    if (action === 'mark_media_reviewed' && item?.type === 'video' && item.durationSeconds == null) {
      const raw = window.prompt('Enter verified video duration in seconds (max 15)') || ''
      const durationSeconds = Number(raw)
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 15) {
        setMessage('Duration must be a number between 0 and 15')
        return
      }
      body.durationSeconds = durationSeconds
    }
    setBusy(id)
    setMessage('')
    try {
      await call('/api/moderation/review', body)
      location.reload()
    } catch (e: any) {
      setMessage(e.message)
    } finally {
      setBusy('')
    }
  }

  async function preview(item: Item) {
    setBusy(item.id)
    setMessage('')
    setPreviewUrl(null)
    try {
      const j = await call('/api/moderation/preview', { submission_id: item.id })
      setSelected({ ...item, preview: j })
      if (j.previewUrl) setPreviewUrl(j.previewUrl)
    } catch (e: any) {
      setMessage(e.message)
    } finally {
      setBusy('')
    }
  }

  async function emergency(action: string) {
    setBusy(action)
    try {
      await call('/api/broadcast/emergency', { action })
      setMessage(`${action} saved. The broadcast worker will apply it on the next poll.`)
    } catch (e: any) {
      setMessage(e.message)
    } finally {
      setBusy('')
    }
  }

  async function resolveReport(id: string, status: 'resolved' | 'dismissed') {
    setBusy(id)
    try {
      await call(`/api/reports/${id}`, { status })
      location.reload()
    } catch (e: any) {
      setMessage(e.message)
    } finally {
      setBusy('')
    }
  }

  async function runCleanup() {
    setBusy('cleanup')
    try {
      const j = await call('/api/cleanup/media', {})
      setMessage(`Cleanup removed ${j.deletedObjects} objects.`)
    } catch (e: any) {
      setMessage(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="text-2xl font-bold">Admin — {role}</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={!!busy} onClick={() => emergency('skip_current')} className="rounded bg-amber-600 px-3 py-2 text-sm text-white">Skip Current</button>
          <button disabled={!!busy} onClick={() => emergency('pause_ugc')} className="rounded bg-red-600 px-3 py-2 text-sm text-white">Pause UGC</button>
          <button disabled={!!busy} onClick={() => emergency('resume_ugc')} className="rounded bg-green-600 px-3 py-2 text-sm text-white">Resume UGC</button>
          <button disabled={!!busy} onClick={runCleanup} className="rounded border px-3 py-2 text-sm">Run media cleanup</button>
        </div>
        {message && <p role="status" className="mt-3 text-sm">{message}</p>}

        <h2 className="mt-6 font-medium">Pending moderation ({pending.length})</h2>
        <div className="mt-2 space-y-2">
          {pending.map((s) => (
            <div key={s.id} className="flex justify-between gap-3 rounded border bg-white p-3">
              <div className="text-sm">
                <b>{s.type}</b> by {s.displayName}<br />
                {s.contentText?.slice(0, 120)}
                {s.type !== 'text' && (
                  <p className="text-zinc-500">
                    duration: {s.durationSeconds ?? 'n/a'} • media reviewed: {s.mediaReviewedAt ? 'yes' : 'no'}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={!!busy} onClick={() => preview(s)} className="rounded border px-3 py-1 text-xs">Preview</button>
                {s.type !== 'text' && (
                  <button disabled={!!busy} onClick={() => act(s.id, 'mark_media_reviewed', s)} className="rounded border px-3 py-1 text-xs">Mark reviewed</button>
                )}
                <button disabled={!!busy} onClick={() => act(s.id, 'approve', s)} className="rounded bg-green-600 px-3 py-1 text-xs text-white">Approve</button>
                <button disabled={!!busy} onClick={() => act(s.id, 'reject', s)} className="rounded bg-zinc-900 px-3 py-1 text-xs text-white">Reject</button>
              </div>
            </div>
          ))}
          {pending.length === 0 && <p className="text-sm text-zinc-500">No pending items.</p>}
        </div>

        <h2 className="mt-8 font-medium">Open reports ({reports.length})</h2>
        <div className="mt-2 space-y-2">
          {reports.map((r) => (
            <div key={r.id} className="flex justify-between gap-3 rounded border bg-white p-3 text-sm">
              <div>
                <b>{r.reason}</b> on {r.submissionId}<br />
                <span className="text-zinc-500">{r.details || 'No details'}</span>
              </div>
              <div className="flex gap-2">
                <button disabled={!!busy} onClick={() => resolveReport(r.id, 'resolved')} className="rounded bg-green-600 px-3 py-1 text-xs text-white">Resolve</button>
                <button disabled={!!busy} onClick={() => resolveReport(r.id, 'dismissed')} className="rounded border px-3 py-1 text-xs">Dismiss</button>
              </div>
            </div>
          ))}
          {reports.length === 0 && <p className="text-sm text-zinc-500">No open reports.</p>}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded border bg-white p-4">
          <h3 className="font-medium">Broadcast queue</h3>
          {queue.map((q) => (
            <div key={q.id} className="border-b py-2 text-xs">{q.type || q.submissionId} — {q.displayName || ''} — {q.status}</div>
          ))}
          {queue.length === 0 && <p className="mt-2 text-xs text-zinc-500">Queue is empty.</p>}
        </div>
        {selected && (
          <div className="rounded border bg-white p-4">
            <h3 className="font-medium">Submission details</h3>
            {previewUrl && selected.type === 'image' && <img src={previewUrl} alt="Submission preview" className="mt-3 max-h-64 w-full object-contain" />}
            {previewUrl && selected.type === 'video' && <video src={previewUrl} controls className="mt-3 max-h-64 w-full" />}
            {selected.type === 'text' && <p className="mt-3 whitespace-pre-wrap text-sm">{selected.contentText}</p>}
            <pre className="mt-3 whitespace-pre-wrap break-all text-xs">
              {JSON.stringify({
                id: selected.id,
                type: selected.type,
                status: selected.status,
                durationSeconds: selected.durationSeconds,
                mediaReviewedAt: selected.mediaReviewedAt,
                createdAt: selected.createdAt,
              }, null, 2)}
            </pre>
            <button onClick={() => { setSelected(null); setPreviewUrl(null) }} className="mt-3 text-sm underline">Close</button>
          </div>
        )}
      </div>
    </div>
  )
}
