/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            'upgrade-insecure-requests',
            // Firebase Auth popup uses a helper iframe on authDomain (*.firebaseapp.com / *.web.app).
            // Google Identity scripts load from apis.google.com + gstatic.com; Auth APIs use identitytoolkit/securetoken.
            "script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.youtube-nocookie.com https://apis.google.com https://www.gstatic.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https://*.googleusercontent.com https://storage.googleapis.com",
            "media-src 'self' blob: https://storage.googleapis.com",
            'frame-src https://www.youtube-nocookie.com https://www.youtube.com https://accounts.google.com https://writtenboard.firebaseapp.com https://writtenboard.web.app',
            "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebasestorage.googleapis.com https://storage.googleapis.com https://firebaseinstallations.googleapis.com https://www.googleapis.com https://accounts.google.com https://writtenboard.firebaseapp.com https://writtenboard.web.app",
          ].join('; '),
        },
      ],
    }]
  },
}

export default nextConfig
