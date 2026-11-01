import { LegalShell } from '@/components/legal/LegalShell'

export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy">
      <p><strong>Last updated:</strong> 2026-11-01 · Draft — requires counsel review before public launch.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Account email from Firebase Authentication (not shown publicly)</li>
        <li>Public nickname and nickname change history</li>
        <li>Submissions (text content and/or private media paths), moderation decisions, reports</li>
        <li>Session cookie (<code>__session</code>, HttpOnly) for signed-in server routes</li>
        <li>Optional App Check tokens when configured</li>
      </ul>
      <h2>How we use data</h2>
      <p>
        To authenticate you, moderate and queue content, operate the livestream pipeline, enforce rate limits,
        investigate abuse, and improve reliability. Pending media is private. Approved items may appear on stream.
      </p>
      <h2>Retention</h2>
      <p>
        Rejected or revoked media is scheduled for deletion after about 30 days via the cleanup job.
        Abandoned pending uploads older than about 24 hours are deleted. Sign-out clears the session cookie and
        revokes refresh tokens.
      </p>
      <h2>Processors</h2>
      <p>Firebase / Google Cloud (Auth, Firestore, Storage, App Hosting) and YouTube for livestream delivery.</p>
      <h2>Requests</h2>
      <p>
        Privacy and deletion requests: <a href="mailto:privacy@writtenboard.com">privacy@writtenboard.com</a>.
      </p>
    </LegalShell>
  )
}
