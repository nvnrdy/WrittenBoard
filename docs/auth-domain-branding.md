# Firebase Auth domain branding (`writtenboard.firebaseapp.com`)

## Why Google shows `writtenboard.firebaseapp.com`

Firebase Web apps use `authDomain` for the Auth helper iframe / redirect handler.
WrittenBoard currently sets:

```text
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=writtenboard.firebaseapp.com
```

Google may show “Continue to writtenboard.firebaseapp.com” because that is the OAuth
continue / helper domain — not because Authorized Domains is missing `writtenboard.com`.

App name/logo on Google screens are separate (Google Auth Platform → Branding) and do
not change the continue-to domain by themselves.

## Can we use `writtenboard.com` as `authDomain`?

Yes, but only after the Auth handler is actually served on that host.

Firebase’s documented path for custom `authDomain`:

1. Host `/__/auth/handler` on the chosen domain (normally via **Firebase Hosting** on the
   custom domain, or a reverse proxy that transparently forwards
   `https://writtenboard.com/__/auth/*` → `https://writtenboard.firebaseapp.com/__/auth/*`).
2. Add the domain to Firebase Authentication → Authorized domains.
3. Add `https://writtenboard.com/__/auth/handler` to the Google OAuth client’s authorized
   redirect URIs.
4. Set `authDomain` to `writtenboard.com` in the web config / App Hosting env.
5. Update CSP `frame-src` / `connect-src` to allow `https://writtenboard.com` for Auth
   helper framing (keep existing Google / YouTube origins).

## WrittenBoard-specific caution

Production is on **Firebase App Hosting**, not classic Hosting. App Hosting does **not**
automatically expose Firebase’s `/__/auth` handler the way default Hosting does.

Until one of these is in place, **do not** switch `authDomain` to `writtenboard.com`:

- Attach classic Firebase Hosting to `writtenboard.com` for auth helpers, or
- Add a verified reverse proxy for `/__/auth` on the App Hosting/custom domain edge.

Changing `authDomain` without the handler will break the currently working Google popup flow.

## Recommendation

Keep `authDomain=writtenboard.firebaseapp.com` for now. Treat custom Auth domain as a
follow-up infra task after Hosting/proxy + OAuth redirect URI + CSP updates are ready and
tested on an unlisted/staging path.
