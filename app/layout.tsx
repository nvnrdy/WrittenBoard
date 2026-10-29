import './globals.css'
import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' })

export const metadata: Metadata = {
  title: 'WrittenBoard — Your voice. The world\'s screen.',
  description: 'Watch the community. Share your voice. A public livestream where approved community submissions appear on YouTube.',
  openGraph: { title: 'WrittenBoard', description: 'Your voice. The world\'s screen.', url: 'https://writtenboard.com' }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="min-h-screen bg-[#fcfcff] text-zinc-900 antialiased font-sans">
        {children}
      </body>
    </html>
  )
}
