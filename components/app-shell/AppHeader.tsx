import Link from 'next/link'
import './app-shell.css'

export function AppHeader({
  isStaff,
  signedIn,
}: {
  isStaff?: boolean
  signedIn?: boolean
}) {
  return (
    <header className="wa-header">
      <Link href="/" className="wa-logo">
        <span className="wa-logo-mark">W</span>
        WrittenBoard
      </Link>
      <nav className="wa-nav" aria-label="Main">
        <Link href="/submit">Submit</Link>
        {isStaff && <Link href="/admin">Admin</Link>}
        {signedIn ? <Link href="/profile">Profile</Link> : <Link href="/auth">Sign In</Link>}
      </nav>
    </header>
  )
}
