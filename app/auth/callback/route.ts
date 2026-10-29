import { NextResponse } from 'next/server'

const ALLOWED = new Set(['/profile', '/submit', '/admin', '/'])

/** Firebase Auth uses client-side popup/redirect; this route only accepts an allowlisted relative path. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const next = searchParams.get('next') || '/profile'
  const safe = ALLOWED.has(next) ? next : '/profile'
  return NextResponse.redirect(new URL(safe, origin))
}
