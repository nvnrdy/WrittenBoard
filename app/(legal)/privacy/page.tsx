export default function Privacy() {
  return (
    <div className="prose mx-auto max-w-3xl p-8">
      <h1>Privacy Policy</h1>
      <p>
        WrittenBoard stores authentication email (private), public nickname, submissions, moderation logs, and reports in Firebase.
        Pending media is private. Rejected or revoked media is scheduled for deletion after 30 days via the cleanup job.
        Session cookies are HttpOnly. Sign-out revokes refresh tokens. Deletion and data requests: privacy@writtenboard.com.
        This summary still requires counsel review before public launch.
      </p>
    </div>
  )
}
