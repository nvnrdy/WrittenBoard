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
# Queue logic only (no ffmpeg): claim, skip, pause, revoke, crash recovery
BROADCAST_MODE=dry-run npm run worker:dev

# Render the real stream to a local .flv file to check what viewers will see
BROADCAST_MODE=record npm run worker:dev

# Continuous YouTube Live stream (ffmpeg >= 5.1 on PATH or FFMPEG_PATH)
BROADCAST_MODE=rtmp YOUTUBE_STREAM_KEY=... npm run worker:dev
```

One worker streams at a time (Firestore lease, others wait as standby). Revoke, Skip and Pause take effect on air immediately, and only `rtmp` mode marks items `broadcast`. For 24/7 hosting use `workers/Dockerfile`. See [docs/broadcast-ops.md](docs/broadcast-ops.md).

## Media cleanup
- Admin button or `POST /api/cleanup/media` with staff auth
- Cron: `CLEANUP_JOB_SECRET=...` header, or `npm run cleanup:media`
- Rejected/revoked media older than 30 days and abandoned `pending-uploads/` older than 24h are deleted

## Docs
- [Broadcast / OBS ops](docs/broadcast-ops.md)
- [DNS & custom domain](docs/dns-and-domain.md)
- [Cleanup, App Check, storage trust](docs/cleanup-and-trust.md)
- [Auth domain branding](docs/auth-domain-branding.md)

## CI
GitHub Actions runs type-check, lint, unit tests, production build, and Playwright smoke e2e on push/PR.

```bash
npm run test:e2e
```

## Staging checklist
- [ ] `package-lock.json` committed after `npm install`
- [ ] type-check, lint, unit tests, production build pass
- [ ] App Hosting has `NEXT_PUBLIC_FIREBASE_*` at **BUILD** time (`apphosting.yaml`)
- [ ] Firestore `(default)` exists; rules/indexes/storage deployed
- [ ] Storage bucket env matches `*.firebasestorage.app` from SDK config
- [ ] Signed upload + moderator preview verified with real Storage
- [ ] Dry-run worker drains an approved text item
- [ ] Record-mode `.flv` shows text, image and video items correctly
- [ ] OBS or RTMP path followed per `docs/broadcast-ops.md`
- [ ] Cleanup cron scheduled and verified (`docs/cleanup-and-trust.md`)
- [ ] Custom domain DNS no longer points to `127.0.0.1` locally; Auth authorized domains updated
- [ ] Budget alerts, App Check, backups, and legal counsel review before public launch
