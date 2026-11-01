# Custom domain & DNS

## What is live today

- **Firebase App Hosting** serves the real Next.js app (backend `writtenboard`).
- Classic Firebase Hosting sites may be empty — do not point users there until something is deployed.
- Public DNS for `writtenboard.com` should resolve to the App Hosting / Google frontend IP (not `127.0.0.1`).

## Local hosts override

If `writtenboard.com` resolves to `127.0.0.1` only on your machine:

1. Open `C:\Windows\System32\drivers\etc\hosts` as Administrator.
2. Remove any line like `127.0.0.1 writtenboard.com` or `127.0.0.1 www.writtenboard.com`.
3. Flush DNS: `ipconfig /flushdns`.
4. Verify with `nslookup writtenboard.com` (should show a public address, not loopback).

## Attach custom domain in Firebase

1. Firebase Console → App Hosting → backend `writtenboard` → Custom domains.
2. Add `writtenboard.com` and `www.writtenboard.com`.
3. Create the DNS records Google shows (A/AAAA or CNAME) at your registrar.
4. Wait for SSL provisioning.
5. Add the custom domain to Firebase Auth → Settings → Authorized domains.

Until DNS + SSL are green, share the App Hosting URL (`*.hosted.app`) for testing.
