/** Human-readable labels for submission statuses that exist in the backend. */
const LABELS: Record<string, string> = {
  pending_moderation: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  revoked: 'Removed',
  broadcast: 'Aired',
  broadcast_dry_run: 'Aired (test)',
}

export function submissionStatusLabel(status?: string | null): string {
  if (!status) return 'Unknown'
  return LABELS[status] || status.replace(/_/g, ' ')
}

export function submissionStatusTone(status?: string | null): 'pending' | 'ok' | 'danger' | 'neutral' {
  switch (status) {
    case 'pending_moderation':
      return 'pending'
    case 'approved':
    case 'broadcast':
    case 'broadcast_dry_run':
      return 'ok'
    case 'rejected':
    case 'revoked':
      return 'danger'
    default:
      return 'neutral'
  }
}
