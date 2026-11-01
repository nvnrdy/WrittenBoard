# Broadcast operator workflow

WrittenBoard can air moderated queue items via the Node worker, or you can use OBS as a human-operated layer on top of YouTube Live.

## Modes

| Mode | Command | Claims YouTube playback? |
|------|---------|--------------------------|
| `dry-run` (default) | `BROADCAST_MODE=dry-run npm run worker:dev` | No — marks `played_dry_run` |
| `rtmp` | `BROADCAST_MODE=rtmp FFMPEG_PATH=ffmpeg YOUTUBE_STREAM_KEY=… npm run worker:dev` | Yes — only after ffmpeg exits 0 |
| OBS (manual) | YouTube Studio + OBS | Yes — operator owns the stream |

## Recommended launch path

1. **Approve content** in `/admin` (preview media, mark reviewed, approve).
2. **Dry-run the worker** against staging/production Firestore until queue claim/skip/pause behave.
3. **Install ffmpeg** and verify `ffmpeg -version`.
4. Create an **unlisted** YouTube Live event; copy the stream key into a local env (never commit it).
5. Either:
   - **A. Worker RTMP:** run `rtmp` mode; confirm frames appear in YouTube Studio preview before going public.
   - **B. OBS hybrid:** start YouTube Live in OBS; use the admin “Now showing / queue” as the rundown; play approved assets from a private folder or browser preview; use Skip/Pause UGC in `/admin` when needed.
6. Set `NEXT_PUBLIC_YOUTUBE_LIVE_ID` (and optional channel URL) so the landing player embeds the live video.

## OBS hybrid checklist

- [ ] OBS installed and linked to the WrittenBoard YouTube channel
- [ ] Scene: slate / “submissions open” when UGC is paused
- [ ] Scene: fullscreen text/image/video for the current approved item
- [ ] Operator watches `/admin` Broadcast queue + emergency controls
- [ ] After the show, leave worker in `dry-run` or stop it so it cannot double-push RTMP

## Fail-closed notes

- Image/video automated moderation returns fail/hold when no provider is configured — humans must review.
- RTMP mode refuses to start without `YOUTUBE_STREAM_KEY` and a working ffmpeg binary.
- Dry-run never writes a `broadcast` result.
