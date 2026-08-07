'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import H3rosWordmark from '@/components/brand/H3rosWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'

// Phase 2 §3.6 (Path A) — fully static prerender for Lighthouse perf.
export const dynamic = 'force-static'

const RELEASES_LATEST =
  'https://github.com/shaurya-05/the-foundry/releases/latest'

type DetectedOs = 'mac' | 'windows' | 'unknown'

function detectOs(): DetectedOs {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent || ''
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform
    || navigator.platform
    || ''
  if (/Mac|iPhone|iPad|iPod/i.test(ua) || /Mac/i.test(platform)) return 'mac'
  if (/Win/i.test(ua) || /Win/i.test(platform)) return 'windows'
  return 'unknown'
}

export default function DownloadPage() {
  const router = useRouter()
  const [os, setOs] = useState<DetectedOs>('unknown')

  useEffect(() => {
    setOs(detectOs())
  }, [])

  const primaryIsMac = os === 'mac' || os === 'unknown'
  const primaryIsWin = os === 'windows' || os === 'unknown'
  // When unknown: both get equal primary treatment. When known: one primary, one secondary.
  const showEqual = os === 'unknown'

  return (
    <div className="min-h-screen bg-off-white font-body">

      {/* Nav — match landing: text links + Sign In CTA */}
      <nav className="flex items-center justify-between py-[18px] px-4 sm:px-8 max-w-[1200px] mx-auto gap-3">
        <button onClick={() => router.push('/')} className="flex items-center gap-2.5 bg-transparent border-0 cursor-pointer min-w-0">
          <Found3ryWordmark size="sm" />
          <span className="hidden sm:inline-flex font-mono font-medium text-[10px] tracking-[0.10em] uppercase text-n-600 items-center gap-1.5">
            · an
            <a href="https://h3ros.com" target="_blank" rel="noopener noreferrer" className="no-underline inline-flex">
              <H3rosWordmark size="xs" />
            </a>
            venture
          </span>
        </button>
        <div className="flex gap-2 sm:gap-3 items-center shrink-0">
          <button
            onClick={() => router.push('/about')}
            className="py-2 px-2.5 sm:px-3.5 bg-transparent border-0 cursor-pointer font-display font-semibold text-[11px] tracking-[0.06em] uppercase text-n-600 hover:text-ink transition-colors duration-100"
          >
            About
          </button>
          <button
            onClick={() => router.push('/download')}
            className="py-2 px-2.5 sm:px-3.5 bg-transparent border-0 cursor-pointer font-display font-semibold text-[11px] tracking-[0.06em] uppercase text-ink transition-colors duration-100"
            aria-current="page"
          >
            Download
          </button>
          <button
            onClick={() => router.push('/login')}
            className="py-2 px-4 bg-ink border-0 rounded-sm cursor-pointer text-off-white font-display font-semibold text-[11px] tracking-[0.06em] uppercase transition-colors duration-100 hover:bg-n-600"
          >
            Sign In
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-10 max-w-[720px] mx-auto text-center">
        <div className="inline-block py-1.5 px-3.5 bg-vellum border border-n-200 rounded-[20px] font-mono font-medium text-[11px] text-ink tracking-[0.12em] uppercase mb-6">
          Desktop App
        </div>
        <h1 className="font-display font-bold text-[clamp(30px,6vw,56px)] tracking-[0.02em] text-ink leading-[1.08] mb-5">
          FOUND3RY on your machine.
        </h1>
        <p className="font-body text-[17px] text-n-600 max-w-[520px] mx-auto leading-[1.6]">
          A local desktop workspace with the same agent and graph — runs on Windows and macOS.
          Free during early access.
        </p>
      </section>

      {/* Download CTAs */}
      <section className="px-6 pb-12 max-w-[560px] mx-auto text-center">
        <div className={`flex flex-col ${showEqual ? 'sm:flex-row' : 'flex-col'} gap-3 justify-center items-stretch sm:items-center mb-4`}>
          {(showEqual || primaryIsMac) && (
            <DownloadLink
              href={RELEASES_LATEST}
              variant={showEqual || os === 'mac' ? 'primary' : 'ghost'}
              label="Download for macOS"
            />
          )}
          {(showEqual || primaryIsWin) && (
            <DownloadLink
              href={RELEASES_LATEST}
              variant={showEqual || os === 'windows' ? 'primary' : 'ghost'}
              label="Download for Windows"
            />
          )}
        </div>

        {!showEqual && (
          <p className="font-body text-[14px] text-n-600 mb-2">
            {os === 'mac' ? (
              <>
                On Windows?{' '}
                <a
                  href={RELEASES_LATEST}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink font-semibold underline underline-offset-2 hover:text-n-600"
                >
                  Download for Windows
                </a>
              </>
            ) : (
              <>
                On a Mac?{' '}
                <a
                  href={RELEASES_LATEST}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink font-semibold underline underline-offset-2 hover:text-n-600"
                >
                  Download for macOS
                </a>
              </>
            )}
          </p>
        )}

        <p className="font-mono text-[11px] text-n-400 tracking-[0.08em] uppercase mt-4">
          Opens the latest GitHub release · pick the installer for your OS
        </p>
      </section>

      {/* What it is */}
      <section className="px-6 py-10 max-w-[720px] mx-auto">
        <EyebrowLabel number="01" keyword="WHAT YOU GET" className="mb-4" />
        <h2 className="font-display font-bold text-[26px] tracking-[0.02em] text-ink mb-5 leading-[1.2]">
          The same workspace, offline-first on your desk.
        </h2>
        <p className={paraStyle}>
          The desktop app packages FOUND3RY as a local install — your data stays on the machine,
          with optional cloud account linking when you want the same ventures on another device.
          Same agent. Same graph. Built for operators who prefer a real app window over a browser tab.
        </p>
      </section>

      {/* Unsigned builds — honest, not buried */}
      <section className="px-6 py-14 bg-vellum border-t border-b border-n-200 my-6">
        <div className="max-w-[720px] mx-auto">
          <EyebrowLabel number="02" keyword="BEFORE YOU INSTALL" className="mb-3.5" />
          <h2 className="font-display font-bold text-[28px] tracking-[0.02em] text-ink mb-5 leading-[1.2]">
            Both builds are currently unsigned.
          </h2>
          <p className={paraStyle}>
            We haven&apos;t set up Apple or Microsoft code signing yet. Your OS will warn you —
            that warning is expected, not a sign the download is broken or malicious.
          </p>
          <p className={paraStyle}>
            <strong className="text-ink font-semibold">Windows:</strong> you may see{' '}
            <em>&ldquo;Windows protected your PC&rdquo;</em>. Click{' '}
            <strong className="text-ink font-semibold">More info</strong>, then{' '}
            <strong className="text-ink font-semibold">Run anyway</strong>.
          </p>
          <p className={paraStyle}>
            <strong className="text-ink font-semibold">macOS:</strong> Gatekeeper may block the first open.
            Right-click the app → <strong className="text-ink font-semibold">Open</strong>, or allow it under
            System Settings → Privacy &amp; Security.
          </p>
        </div>
      </section>

      {/* Requirements note */}
      <section className="px-6 py-10 max-w-[720px] mx-auto">
        <EyebrowLabel number="03" keyword="REQUIREMENTS" className="mb-4" />
        <h2 className="font-display font-bold text-[26px] tracking-[0.02em] text-ink mb-5 leading-[1.2]">
          System Python on PATH.
        </h2>
        <p className={paraStyle}>
          The packaged app uses your system Python (<code className="font-mono text-[14px] text-ink">python</code> on
          Windows, <code className="font-mono text-[14px] text-ink">python3</code> on macOS) for the local API sidecar.
          Install a recent Python 3 if you don&apos;t already have one before first launch.
        </p>
      </section>

      {/* Footer */}
      <footer className="py-7 px-6 border-t border-n-200 max-w-[1200px] mx-auto flex items-center justify-between flex-wrap gap-3">
        <span className="font-mono font-medium text-[11px] text-n-600 tracking-[0.06em] inline-flex items-center gap-2 flex-wrap">
          <Found3ryWordmark size="sm" />
          <span className="hidden sm:inline">· an h3ros venture · workspace graph for builders</span>
          <span className="sm:hidden">· an h3ros venture</span>
        </span>
        <nav className="font-mono font-medium text-[10px] text-n-600 tracking-[0.10em] uppercase flex items-center gap-4">
          <a href="/privacy" className="hover:text-ink">Privacy</a>
          <a href="/terms" className="hover:text-ink">Terms</a>
          <span className="text-n-400">© {new Date().getFullYear()}</span>
        </nav>
      </footer>
    </div>
  )
}

function DownloadLink({
  href,
  label,
  variant,
}: {
  href: string
  label: string
  variant: 'primary' | 'ghost'
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-sm cursor-pointer font-display font-semibold text-[14px] tracking-[0.06em] uppercase transition-colors duration-100 no-underline'
  const styles =
    variant === 'primary'
      ? 'py-3.5 px-8 bg-arc-cyan text-ink border-0 hover:bg-arc-cyan-deep'
      : 'py-3.5 px-7 bg-transparent border border-ink text-ink hover:bg-ink hover:text-off-white'

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} ${styles}`}
    >
      <span>{label}</span>
      <span aria-hidden="true">→</span>
    </a>
  )
}

const paraStyle = 'font-body text-[16px] leading-[1.75] text-n-600 mb-4'
