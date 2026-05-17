import type { Metadata } from 'next'
import { Barlow_Condensed, Barlow, IBM_Plex_Mono, IBM_Plex_Serif, Archivo, Archivo_Black } from 'next/font/google'
import '../styles/globals.css'
import { AuthProvider } from '@/lib/auth'
// Light theme only — no ThemeProvider needed

// ─── Legacy fonts (Phase 6 will remove Barlow stack) ─────────────────────────
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

// ─── H3ROS Design Language v1.2 type stack ───────────────────────────────────
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-archivo',
  display: 'swap',
})

const archivoBlack = Archivo_Black({
  subsets: ['latin'],
  weight: ['400'], // Archivo Black is a single-weight family
  variable: '--font-archivo-black',
  display: 'swap',
})

const plexSerif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['500'],
  style: ['normal', 'italic'],
  variable: '--font-plex-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'The FOUND3RY — by h3ros',
  description: 'Workspace graph for multi-venture operators. Built by h3ros.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${barlowCondensed.variable} ${barlow.variable} ${ibmPlexMono.variable} ${archivo.variable} ${archivoBlack.variable} ${plexSerif.variable}`}
      suppressHydrationWarning
    >
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  )
}
