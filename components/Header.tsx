import Link from 'next/link'
import { Logo } from './Logo'

export function Header({ user, isStaff }: { user?: { id?: string; uid?: string; email?: string | null } | null; isStaff?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/"><Logo /></Link>
        <nav className="flex items-center gap-2">
          <Link href="/submit" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-black">Submit Content</Link>
          {isStaff && <Link href="/admin" className="px-3 py-2 text-sm">Admin</Link>}
          {user ? <Link href="/profile" className="px-3 py-2 text-sm">Profile</Link> : <Link href="/auth" className="px-3 py-2 text-sm">Sign in</Link>}
        </nav>
      </div>
    </header>
  )
}
