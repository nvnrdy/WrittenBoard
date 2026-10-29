# WrittenBoard — Firebase platform

Firebase-native Next.js app for moderated community submissions and livestream queueing. **Not production-certified until the staging checklist below is green.**

## Stack
- Next.js 15 App Router + TypeScript + Tailwind
- Firebase Auth (Google + email/password), Firestore, Storage
- Firebase Admin SDK on the server only
- Broadcast worker (`workers/broadcast-worker.ts`) with `dry-run` and `rtmp` modes

## Local setup
1. Create a **separate staging** Firebase project. Enable Auth, Firestore, Storage.
2. Copy `.env.example` → `.env.local` and fill web + admin values.
3. Prefer `gcloud auth application-default login` for Admin credentials.
4. Deploy rules/indexes: `firebase deploy --only firestore:rules,firestore:indexes,storage --project <staging>`
5. `npm install`
6. `npm run type-check && npm run lint && npm test && npm run build`
7. `npm run dev`
8. Create a user, then `FIREBASE_BOOTSTRAP_ADMIN_UID=<uid> npm run admin:bootstrap`

## Security model
- Clients cannot write Firestore business data or read/write Storage objects through security rules.
- Media uploads use short-lived Admin-signed write URLs issued only after nickname + rate-limit checks.
- Moderator previews use short-lived signed read URLs.
- API routes verify Firebase ID tokens or the HttpOnly `__session` cookie; staff actions require custom claims.
- Sign-out clears the cookie and revokes refresh tokens.
- Daily submission caps and report caps use Firestore transactions.

## Broadcast worker
```bash
# Verifies queue claim/render/skip without claiming YouTube playback
BROADCAST_MODE=dry-run npm run worker:dev

# Requires ffmpeg on PATH (or FFMPEG_PATH) and YOUTUBE_STREAM_KEY
BROADCAST_MODE=rtmp FFMPEG_PATH=ffmpeg YOUTUBE_STREAM_KEY=... npm run worker:dev
```

Dry-run marks queue items `played` with result `played_dry_run`. Only `rtmp` mode may mark `broadcast` after ffmpeg exits successfully.

## Media cleanup
- Admin button or `POST /api/cleanup/media` with staff auth
- Cron: `CLEANUP_JOB_SECRET=...` header, or `npm run cleanup:media`
- Rejected/revoked media older than 30 days and abandoned `pending-uploads/` older than 24h are deleted

## Staging checklist
- [ ] `package-lock.json` committed after `npm install`
- [ ] type-check, lint, unit tests, production build pass
- [ ] Rules deployed to staging; emulator or staging tests for role escalation and direct client writes
- [ ] Signed upload + moderator preview verified with real Storage
- [ ] Dry-run worker drains an approved text item
- [ ] RTMP worker tested against an unlisted stream only after ffmpeg is installed
- [ ] Budget alerts, App Check, backups, and legal review completed before public launch
