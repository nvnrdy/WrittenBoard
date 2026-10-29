# WrittenBoard security status

**Status: staging-ready engineering build; not publicly launched.** Validate against a dedicated Firebase staging project before accepting public uploads.

## Fixed in this revision
- Removed Supabase packages, clients, SQL migrations, and worker dependency.
- Storage rules deny all client access; uploads use Admin-signed URLs after nickname and rate-limit checks.
- Firestore rules deny client writes to submissions, nicknames, rate limits, reports, audit logs, system, and broadcast_queue.
- Session cookie creation requires a matching Origin; logout revokes refresh tokens.
- Nickname changes read the previous claim inside a transaction; admin bootstrap no longer clears displayName.
- Submission rate limit is reserved before OpenAI moderation; failed submissions roll the counter back and delete staged uploads.
- Moderator media preview via signed URLs; `mark_media_reviewed` + MP4 duration parsing; WebM requires moderator-confirmed duration.
- Reports are rate-limited, de-duplicated transactionally, and reviewable in admin.
- Media cleanup API/script for 30-day rejected media and 24-hour abandoned pending uploads.
- Broadcast worker rewritten for Firebase with dry-run (default) and rtmp modes; dry-run never claims YouTube playback.
- Profile/admin pages serialize Firestore Timestamps for client components.
- Fonts, headers, CSP connect-src, legal copy, and security tests updated.

## Still required before public launch
- Install dependencies and commit the lockfile in CI.
- Deploy rules/indexes to a separate staging Firebase project and run end-to-end tests there.
- Install ffmpeg and verify RTMP mode against an unlisted stream.
- Configure App Check, budget alerts, backups, and incident response.
- Legal counsel review of Terms/Privacy.
- Consider App Check + malware scanning for production media pipelines.
