'use client'
import { useState } from 'react'
import { firebaseClient } from '@/lib/firebase/client'

export default function SubmitClient() {
  const [type, setType] = useState<'text' | 'image' | 'video'>('text')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  async function authHeaders() {
    const user = firebaseClient().auth.currentUser
    if (!user) throw new Error('Please sign in again')
    const token = await user.getIdToken()
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  }

  async function submit() {
    setError('')
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
        const put = await fetch(prepared.uploadUrl, {
          method: 'PUT',
          headers: prepared.headers,
          body: file,
        })
        if (!put.ok) throw new Error('Upload failed')
        body.storagePath = prepared.storagePath
      }

      setProgress('Submitting for review...')
      const r = await fetch('/api/submissions', { method: 'POST', headers, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Submission failed')
      setProgress('Submitted for moderation. It will not appear on the stream until approved.')
      setText('')
      setFile(null)
      const input = document.querySelector<HTMLInputElement>('input[type=file]')
      if (input) input.value = ''
    } catch (e: any) {
      setError(e.message || 'Submission failed')
      setProgress('')
    }
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-bold">Submit Content</h1>
      <p className="mt-1 text-sm text-zinc-600">Max 500 characters text, 5MB image, 25MB / 15s video. Human moderated before broadcast.</p>
      <div className="mt-4 flex gap-2">
        {(['text', 'image', 'video'] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={`rounded-full border px-4 py-2 text-sm ${type === t ? 'bg-zinc-900 text-white' : 'bg-white'}`}>{t}</button>
        ))}
      </div>
      <div className="mt-6 space-y-4 rounded-[20px] border bg-white p-5">
        {type === 'text' ? (
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={5} placeholder="Your message..." className="w-full rounded border p-3 text-sm" />
        ) : (
          <input type="file" accept={type === 'image' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/webm'} onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-sm" />
        )}
        <button onClick={submit} className="w-full rounded-full bg-zinc-900 py-3 text-sm font-medium text-white">Submit for review</button>
        {progress && <p role="status" className="text-sm text-green-700">{progress}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <p className="text-[11px] text-zinc-500">Pending media is private. By submitting you allow WrittenBoard to display approved content on stream.</p>
      </div>
    </div>
  )
}
