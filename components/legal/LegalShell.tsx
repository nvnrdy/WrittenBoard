import Link from 'next/link'
import type { ReactNode } from 'react'
import '@/components/app-shell/app-shell.css'

export function LegalShell({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="wa">
      <header className="wa-header">
        <Link href="/" className="wa-logo">
          <span className="wa-logo-mark">W</span>
          WrittenBoard
        </Link>
        <nav className="wa-nav" aria-label="Legal">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/guidelines">Guidelines</Link>
          <Link href="/contact">Contact</Link>
        </nav>
      </header>
      <main className="wa-main" style={{ maxWidth: 720 }}>
        <p className="wa-muted" style={{ marginBottom: 8 }}>Legal · draft for counsel review</p>
        <h1 style={{ margin: '0 0 16px', fontSize: 34 }}>{title}</h1>
        <div className="wa-card" style={{ lineHeight: 1.6 }}>
          {children}
        </div>
        <p className="wa-muted" style={{ marginTop: 20 }}>
          These pages are operational drafts, not legal advice. Have counsel review before public launch.
        </p>
      </main>
    </div>
  )
}
