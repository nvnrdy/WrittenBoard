# Broadcast operator workflow

WrittenBoard airs moderated queue items with the broadcast worker (`workers/broadcast-worker.ts`). You can also use OBS as a human-operated layer on top of YouTube Live.

## Modes

| Mode | Command | What it does |
|------|---------|--------------|
| `dry-run` (default) | `BROADCAST_MODE=dry-run npm run worker:dev` | Full queue logic, no ffmpeg. Marks items `played_dry_run` / `broadcast_dry_run`. Never claims YouTube playback. |
| `record` | `BROADCAST_MODE=record npm run worker:dev` | Renders the real stream into `workers/.work/record-*.flv` (or `BROADCAST_RECORD_FILE`). Use it to check what viewers will see. Submissions are not marked broadcast. |
| `rtmp` | `BROADCAST_MODE=rtmp YOUTUBE_STREAM_KEY=… npm run worker:dev` | Streams continuously to YouTube Live. Marks items `broadcast` only after they finish on air. |
| OBS (manual) | YouTube Studio + OBS | The operator owns the stream. Keep the worker in `dry-run` or stopped. |

`record` and `rtmp` need **ffmpeg 5.1 or newer, built with the drawtext filter** (standard Windows/macOS/Linux builds include it). Set `FFMPEG_PATH` if ffmpeg is not on `PATH`.

## How the worker behaves

- **One continuous stream.** One ffmpeg encoder holds the YouTube connection for the whole session. Items are fed into it frame by frame, and an idle slate shows between items, so the stream never drops between submissions. Output is 1280×720, H.264 at 2.5 Mbps (`BROADCAST_VIDEO_KBPS`), 2-second keyframes, and a silent AAC audio track.
- **What airs:**
  - Text appears on a WrittenBoard card with `@nickname`, auto-sized to fit and wrapped.
  - Images are letterboxed.
  - Videos are capped at 15 s and play without their own audio.
  - Text and images stay on screen for `BROADCAST_HOLD_MS` (default 8000).
- **Admin controls act immediately:**
  - **Revoke / Reject** takes the item off air within about a second, and it stays revoked. It is never marked broadcast.
  - **Skip** cuts to the slate right away.
  - **Pause UGC** takes the current item off air. It is requeued and plays again after you resume.
- **Only one worker streams at a time.** The worker takes a lease in Firestore (`system/broadcast_worker`). A second copy waits in standby and takes over within about `BROADCAST_LEASE_TTL_MS` (30 s) if the first one dies. A worker that loses its lease stops and exits.
- **Crash recovery.** When a worker takes over, any item left `playing` is requeued. Failed items retry with backoff and are marked `failed` after `BROADCAST_MAX_ATTEMPTS` (3).
- **Health.** If `PORT` is set, `GET /` returns JSON with `phase`, `leaseHeld`, `encoderUp` and `onAir`.

### Fonts and languages

Text uses `BROADCAST_FONT_FILE`. The default is Arial on Windows, Arial on macOS, and DejaVu Sans on Linux and in the Docker image.

- For Hindi or other non-Latin scripts, point it at a font that covers them (e.g. Noto Sans Devanagari). ffmpeg's drawtext does not do complex shaping, so conjuncts may render imperfectly.
- Emoji are removed from on-air text, because broadcast fonts show them as empty boxes.

## Running it 24/7

The worker is a long-running process, not part of App Hosting. Run exactly one active copy (a standby is optional) on infrastructure that restarts it.

**Recommended: a small Compute Engine VM (e2-medium) running the container**

```bash
# Build and push (from the repo root)
gcloud artifacts repositories create writtenboard --repository-format=docker --location=asia-southeast1
docker build -f workers/Dockerfile -t asia-southeast1-docker.pkg.dev/writtenboard/writtenboard/worker:latest .
docker push asia-southeast1-docker.pkg.dev/writtenboard/writtenboard/worker:latest

# Store the stream key in Secret Manager, never in the image or repo
printf '%s' "<stream key>" | gcloud secrets create youtube-stream-key --data-file=-
```

Run the container with `--restart=always`. Pass `BROADCAST_MODE=rtmp` and `YOUTUBE_STREAM_KEY` (fetched from Secret Manager at boot). Use a service account that has:

- `roles/datastore.user`
- `roles/storage.objectViewer` on the media bucket
- `roles/secretmanager.secretAccessor`

**Cloud Run alternative:** deploy the same image as a service with `--no-cpu-throttling --min-instances=1 --max-instances=1 --cpu=2 --memory=1Gi`. The health endpoint satisfies Cloud Run's port check. Cloud Run may replace the instance at any time; the lease and crash recovery make that safe, but expect a short slate gap when it happens.

libx264 at 720p30 `veryfast` needs about 1 to 1.5 vCPU.

## Recommended launch path

1. **Approve content** in `/admin`: preview the media, mark it reviewed, then approve.
2. **Dry-run** against the staging Firestore until claim, skip, pause and revoke behave as described above.
3. **Record mode:** let a few items play, stop with Ctrl+C, and watch the `.flv` file.
4. Create an **unlisted** YouTube Live event. Put the stream key in Secret Manager or a local env file, never in the repo.
5. Run **`rtmp` mode** and confirm in the YouTube Studio preview that the slate and items appear. Then make the event public.
6. Set `NEXT_PUBLIC_YOUTUBE_LIVE_ID` (and optionally the channel URL) so the landing page embeds the stream.

## OBS hybrid checklist

- [ ] OBS installed and linked to the WrittenBoard YouTube channel
- [ ] Scene: slate / "submissions open" while UGC is paused
- [ ] Scene: fullscreen text/image/video for the current approved item
- [ ] Operator watches the `/admin` broadcast queue and emergency controls
- [ ] Worker stopped or in `dry-run`, so it cannot push to the same stream key

## Fail-closed notes

- Image and video automated moderation returns fail/hold when no provider is configured, so a human must review.
- The worker re-checks that a submission is still `approved` when it claims the item, and watches it the whole time it is on air.
- RTMP mode refuses to start without `YOUTUBE_STREAM_KEY`, a working ffmpeg with drawtext, and a readable font.
- The stream key is removed from all logged ffmpeg output.
- Dry-run and record modes never write a `broadcast` result.
