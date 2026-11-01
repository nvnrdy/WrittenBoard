'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { firebaseClient } from '@/lib/firebase/client'
import { initAppCheck } from '@/lib/firebase/app-check'
import { AppHeader } from '@/components/app-shell/AppHeader'
import '@/components/app-shell/app-shell.css'

type ContentType = 'text' | 'image' | 'video'

const TYPE_META: Record<ContentType, { label: string; limit: string }> = {
  text: { label: 'Text', limit: 'Up to 500 characters' },
  image: { label: 'Image', limit: 'JPEG, PNG or WebP · max 5MB' },
  video: { label: 'Video', limit: 'MP4 or WebM · max 25MB · 15 seconds' },
}

export default function SubmitClient({ isStaff }: { isStaff?: boolean }) {
  const [type, setType] = useState<ContentType>('text')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const previewUrl = useMemo(() => {
    if (!file || type === 'text') return null
    return URL.createObjectURL(file)
  }, [file, type])

  useEffect(() => { void initAppCheck() }, [])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function selectType(next: ContentType) {
    if (busy) return
    setType(next)
    setFile(null)
    setError('')
    setProgress('')
    setDone(false)
  }

  async function authHeaders() {
    const user = firebaseClient().auth.currentUser
    if (!user) throw new Error('Please sign in again')
    const token = await user.getIdToken()
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  }

  async function submit() {
    if (busy) return
    setError('')
    setDone(false)
    setBusy(true)
    setProgress('Preparing submission...')
    try {
      const headers = await authHeaders()
      const body: Record<string, unknown> = { type }
      if (type === 'text') {
        body.content = text
      } else {
        if (!file) throw new Error('Choose a file')
        const max = type === 'image' ? 5 * 1024 * 1024 : 25 * 1024 * 1024
        if (file.size > max) throw new Error('File exceeds the allowed size')
        const allowed = type === 'image' ? ['image/jpeg', 'image/png', 'image/webp'] : ['video/mp4', 'video/webm']
        if (!allowed.includes(file.type)) throw new Error('Unsupported file type')

        setProgress('Requesting secure upload URL...')
        const prepare = await fetch('/api/uploads/prepare', {
          method: 'POST',
          headers,
          body: JSON.stringify({ type, contentType: file.type, size: file.size }),
        })
        const prepared = await prepare.json()
        if (!prepare.ok) throw new Error(prepared.error || 'Could not prepare upload')

        setProgress('Uploading private media...')
        const put = await fetch(prepared.uploadUrl, { method: 'PUT', headers: prepared.headers, body: file })
        if (!put.ok) throw new Error('Upload failed')
        body.storagePath = prepared.storagePath
      }

      setProgress('Submitting for review...')
      const r = await fetch('/api/submissions', { method: 'POST', headers, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Submission failed')
      setProgress('')
      setDone(true)
      setText('')
      setFile(null)
      const input = document.querySelector<HTMLInputElement>('input#file')
      if (input) input.value = ''
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submission failed')
      setProgress('')
      setDone(false)
    } finally {
      setBusy(false)
    }
  }

  function resetForm() {
    setDone(false)
    setError('')
    setProgress('')
    setText('')
    setFile(null)
  }

  return (
    <div className="wa">
      <AppHeader signedIn isStaff={isStaff} />
      <main className="wa-main wa-main-narrow">
        <h1 className="wa-page-title">Submit content</h1>
        <p className="wa-lead">
          Share text, an image or a short video. A human moderator reviews every submission before anything can appear on the WrittenBoard livestream.
        </p>

        <div className="wa-type-tabs" role="group" aria-label="Content type">
          {(Object.keys(TYPE_META) as ContentType[]).map((t) => (
            <button
              key={t}
              type="button"
              className="wa-type-tab"
              aria-pressed={type === t}
              disabled={busy}
              onClick={() => selectType(t)}
            >
              {TYPE_META[t].label}
            </button>
          ))}
        </div>
        <div className="wa-limits" aria-live="polite">
          <span className="wa-chip">{TYPE_META[type].limit}</span>
          <span className="wa-chip">Human review required</span>
        </div>

        {done ? (
          <div className="wa-success" role="status">
            <h2>Submitted for review</h2>
            <p>
              Thanks — your content is pending moderation. It will not appear on the stream until a moderator approves it.
            </p>
            <div className="wa-row" style={{ marginTop: 18 }}>
              <button type="button" className="wa-btn wa-btn-primary" onClick={resetForm}>
                Submit another
              </button>
              <Link href="/profile" className="wa-btn">View profile</Link>
            </div>
          </div>
        ) : (
          <div className="wa-card" style={{ marginTop: 18 }}>
            <p className="wa-notice">
              Pending media stays private. By submitting, you allow WrittenBoard to display approved content on stream with your public username.
            </p>

            {type === 'text' ? (
              <>
                <div className="wa-field">
                  <label htmlFor="content">Your message</label>
                  <textarea
                    id="content"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={500}
                    rows={6}
                    placeholder="What should appear on stream?"
                    disabled={busy}
                  />
                </div>
                <p className="wa-char-count" aria-live="polite">{text.length}/500</p>
              </>
            ) : (
              <>
                <div className="wa-field">
                  <label htmlFor="file">Choose {type}</label>
                  <div className="wa-file-box">
                    <input
                      id="file"
                      type="file"
                      accept={type === 'image' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/webm'}
                      disabled={busy}
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                    <p className="wa-field-hint">{TYPE_META[type].limit}</p>
                  </div>
                </div>
                {previewUrl && type === 'image' && (
                  <div className="wa-preview-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="wa-preview" src={previewUrl} alt="Selected image preview" />
                  </div>
                )}
                {previewUrl && type === 'video' && (
                  <div className="wa-preview-wrap">
                    <video className="wa-preview" src={previewUrl} controls playsInline preload="metadata" />
                  </div>
                )}
              </>
            )}

            <button
              type="button"
              className="wa-btn wa-btn-primary"
              style={{ width: '100%' }}
              disabled={busy || (type === 'text' ? text.trim().length === 0 : !file)}
              onClick={submit}
            >
              {busy ? 'Submitting…' : 'Submit for review'}
            </button>
            {progress && <p role="status" className="wa-status wa-status-ok">{progress}</p>}
            {error && <p role="alert" className="wa-status wa-status-err">{error}</p>}
          </div>
        )}
      </main>
    </div>
  )
}
