import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/firebase/server-auth'
import { ensureProfileWithPublicUsername } from '@/lib/auth/claim-username'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const result = await ensureProfileWithPublicUsername({
      uid: user.uid,
      email: user.email || null,
    })
    return NextResponse.json({
      ok: true,
      display_name: result.displayName,
      assigned: result.assigned,
    })
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return NextResponse.json(
      { error: err.status ? err.message : 'Could not create profile' },
      { status: err.status || 500 },
    )
  }
}
