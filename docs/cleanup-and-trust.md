# Retention, cleanup, App Check, storage

## Storage bucket

Use the SDK bucket name from Firebase Console / `apps:sdkconfig`:

- Prefer `writtenboard.firebasestorage.app`
- Avoid assuming `writtenboard.appspot.com` unless that is the bucket the SDK reports

Keep `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` and `FIREBASE_STORAGE_BUCKET` identical.

## Media moderation stance

`MODERATION_PROVIDER=manual` (default): text/image automated checks **fail closed** — items stay pending for humans.

OpenAI text moderation is optional. Image/video have no automated pass path; the admin “Mark reviewed” + Approve flow is required.

## Cleanup schedule

Cleanup deletes:

- Rejected/revoked submission media older than **30 days**
- Abandoned `pending-uploads/` objects older than **24 hours**

### Options

1. **Admin button** in `/admin` → Cleanup (staff session).
2. **HTTP cron** against the deployed app:

```bash
curl -X POST "https://<app-host>/api/cleanup/media" \
  -H "x-cleanup-secret: $CLEANUP_JOB_SECRET" \
  -H "Content-Type: application/json"
```

3. **Local / Cloud Run job:** `npm run cleanup:media` with Admin credentials.

### Cloud Scheduler example

```bash
gcloud scheduler jobs create http writtenboard-media-cleanup \
  --location=asia-southeast1 \
  --schedule="0 4 * * *" \
  --uri="https://<app-host>/api/cleanup/media" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-cleanup-secret=<CLEANUP_JOB_SECRET>" \
  --project=writtenboard
```

Set `CLEANUP_JOB_SECRET` in App Hosting secrets/env (runtime only; not a NEXT_PUBLIC value). Verify once on live data with a dry count, then enable the schedule.

## App Check

1. Enable App Check in Firebase Console for the web app (reCAPTCHA v3).
2. Set `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` in `.env.local` and App Hosting `apphosting.yaml` (BUILD + RUNTIME).
3. Client pages call `initAppCheck()`; without the site key the helper is a no-op.
