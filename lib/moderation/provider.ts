export interface ModerationResult {
  pass: boolean
  score?: number
  labels?: Record<string, boolean>
  error?: string
}

export async function moderateText(text: string): Promise<ModerationResult> {
  const provider = process.env.MODERATION_PROVIDER || 'manual'
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return { pass: false, error: `Moderation provider returned HTTP ${res.status}` }
      const data = await res.json()
      const result = data?.results?.[0]
      if (typeof result?.flagged !== 'boolean') {
        return { pass: false, error: 'Moderation provider returned an invalid response' }
      }
      return { pass: !result.flagged, score: result.flagged ? 1 : 0, labels: result.categories }
    } catch {
      return { pass: false, error: 'Moderation provider unavailable' }
    }
  }
  return { pass: false, error: 'Manual review required; automated provider not configured' }
}

export async function moderateImage(_buffer: Buffer): Promise<ModerationResult> {
  return { pass: false, error: 'Image moderation is not configured; manual review required' }
}
