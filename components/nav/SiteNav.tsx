'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import { firebaseClient } from '@/lib/firebase/client'
import './site-nav.css'

type Props = {
  signedIn?: boolean
  isStaff?: boolean
  variant?: 'app' | 'landing'
}

export function SiteNav({ signedIn, isStaff, variant = 'app' }: Props) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function onPointer(e: MouseEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  function closeMenu() {
    setOpen(false)
  }

  async function handleSignOut() {
    closeMenu()
    try {
      await signOut(firebaseClient().auth)
    } catch { /* client may already be signed out */ }
    await fetch('/api/auth/session', { method: 'DELETE' })
    location.href = '/'
  }

  return (
    <header className={`sn-header sn-header-${variant}`}>
      <Link href="/" className="sn-logo" aria-label="WrittenBoard home" onClick={closeMenu}>
        <span className="sn-logo-mark">W</span>
        WrittenBoard
      </Link>

      <nav className="sn-desktop" aria-label="Main">
        {variant === 'landing' && (
          <>
            <a href="#how" className="sn-link">How it works</a>
            <a href="#featured" className="sn-link">Featured</a>
          </>
        )}
        {signedIn ? (
          <>
            <Link href="/submit" className="sn-action">Submit Content</Link>
            {isStaff && <Link href="/admin" className="sn-action">Admin</Link>}
            <Link href="/profile" className="sn-action">Profile</Link>
          </>
        ) : (
          <Link href="/auth" className="sn-action">Sign In</Link>
        )}
      </nav>

      <button
        ref={buttonRef}
        type="button"
        className="sn-menu-btn"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <div
        ref={panelRef}
        id={panelId}
        className="sn-panel"
        data-open={open ? 'true' : 'false'}
        aria-hidden={!open}
        role="menu"
        aria-label="Site menu"
      >
        <Link href="/" role="menuitem" onClick={closeMenu}>Home</Link>
        <Link href="/submit" role="menuitem" onClick={closeMenu}>Submit Content</Link>
        <Link href="/profile" role="menuitem" onClick={closeMenu}>Profile</Link>
        {isStaff && <Link href="/admin" role="menuitem" onClick={closeMenu}>Admin</Link>}
        <div className="sn-panel-sep" aria-hidden="true" />
        {signedIn ? (
          <button type="button" role="menuitem" onClick={handleSignOut}>Sign Out</button>
        ) : (
          <Link href="/auth" role="menuitem" onClick={closeMenu}>Sign In</Link>
        )}
      </div>
    </header>
  )
}
