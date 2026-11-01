import './globals.css'
import type { Metadata } from 'next'
import { Bricolage_Grotesque, DM_Sans } from 'next/font/google'

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
})

const body = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  title: "WrittenBoard — Your voice. The world's screen.",
  description: 'Watch the community. Share your voice. A public livestream where approved community submissions appear on YouTube.',
  openGraph: { title: 'WrittenBoard', description: "Your voice. The world's screen.", url: 'https://writtenboard.com' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className={`${display.variable} ${body.variable} min-h-screen antialiased`}>
        {children}
      </body>
    </html>
  )
}
