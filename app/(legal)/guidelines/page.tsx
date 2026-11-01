import { LegalShell } from '@/components/legal/LegalShell'

export default function Guidelines() {
  return (
    <LegalShell title="Community Guidelines">
      <p>
        Everything on WrittenBoard is reviewed by a person before it can appear on stream. Automated checks may
        hold or fail closed; they do not replace human review for images and videos.
      </p>
      <h2>Not allowed</h2>
      <ul>
        <li>Sexual content or exploitation</li>
        <li>Graphic violence or gore</li>
        <li>Hate, harassment, or threats</li>
        <li>Doxxing or private personal data of others</li>
        <li>Scams, spam, or phishing</li>
        <li>Impersonation</li>
        <li>Copyright or trademark infringement</li>
        <li>Any other illegal content</li>
      </ul>
      <h2>Submission limits</h2>
      <ul>
        <li>Text up to 500 characters</li>
        <li>Images up to 5MB (JPEG, PNG, WebP)</li>
        <li>Videos up to 25MB / 15 seconds (MP4, WebM)</li>
      </ul>
      <h2>Reporting</h2>
      <p>
        Use in-product reporting where available, or email{' '}
        <a href="mailto:moderation@writtenboard.com">moderation@writtenboard.com</a>.
      </p>
    </LegalShell>
  )
}
