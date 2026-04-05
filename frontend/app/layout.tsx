import type { Metadata } from 'next'
import { Barlow_Condensed, Barlow, IBM_Plex_Mono } from 'next/font/google'
import '../styles/globals.css'
import { AuthProvider } from '@/lib/auth'

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow-condensed',
  display: 'swap',
})

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-barlow',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'The FOUND3RY — by h3ros',
  description: 'AI-powered builder operating system. Source → Forge → Cast → Ship.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${barlowCondensed.variable} ${barlow.variable} ${ibmPlexMono.variable}`}
      suppressHydrationWarning
    >
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  )
}
