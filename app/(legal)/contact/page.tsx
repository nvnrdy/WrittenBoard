import { LegalShell } from '@/components/legal/LegalShell'

export default function Contact() {
  return (
    <LegalShell title="Contact">
      <ul>
        <li>Support: <a href="mailto:support@writtenboard.com">support@writtenboard.com</a></li>
        <li>Privacy: <a href="mailto:privacy@writtenboard.com">privacy@writtenboard.com</a></li>
        <li>Moderation: <a href="mailto:moderation@writtenboard.com">moderation@writtenboard.com</a></li>
        <li>Copyright / safety: <a href="mailto:abuse@writtenboard.com">abuse@writtenboard.com</a></li>
        <li>Legal: <a href="mailto:legal@writtenboard.com">legal@writtenboard.com</a></li>
      </ul>
      <p className="wa-muted">We aim to respond within a few business days. Livestream emergencies should go through the ops console when you are staff.</p>
    </LegalShell>
  )
}
