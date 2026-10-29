import { Timestamp } from 'firebase-admin/firestore'

/** Convert Firestore Timestamps (and nested maps/arrays) into JSON-safe values for client components. */
export function serializeForClient<T>(value: T): T {
  return walk(value) as T
}

function walk(value: unknown): unknown {
  if (value == null) return value
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try { return (value as { toDate: () => Date }).toDate().toISOString() } catch { /* fall through */ }
  }
  if (Array.isArray(value)) return value.map(walk)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v)
    return out
  }
  return value
}
