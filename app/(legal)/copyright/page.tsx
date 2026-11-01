import { LegalShell } from '@/components/legal/LegalShell'

export default function Copyright() {
  return (
    <LegalShell title="Copyright & Removal">
      <p><strong>Last updated:</strong> 2026-11-01 · Draft — requires counsel review before public launch.</p>
      <p>
        WrittenBoard respects intellectual property. If you believe content on the stream or in our systems
        infringes your copyright, send a notice to{' '}
        <a href="mailto:abuse@writtenboard.com">abuse@writtenboard.com</a> including:
      </p>
      <ul>
        <li>Identification of the copyrighted work</li>
        <li>URL, timestamp, nickname, or submission id if known</li>
        <li>Your contact information</li>
        <li>A good-faith statement that use is not authorized</li>
        <li>A statement under penalty of perjury that the information is accurate and you are authorized to act</li>
        <li>Your physical or electronic signature</li>
      </ul>
      <p>
        Moderators review copyright reports in the admin reports queue. Valid claims lead to removal from the
        queue and/or media deletion. Repeat infringers may be suspended. This page is not a substitute for a
        DMCA agent designation where required by law.
      </p>
    </LegalShell>
  )
}
