'use client'

import Glyph3 from '@/components/brand/Glyph3'
import type { VoiceState } from '@/lib/voice'

type H3roJarvisOrbProps = {
  state: VoiceState
  size?: number
  onClick?: () => void
  disabled?: boolean
  'aria-label'?: string
}

/**
 * Iron Man / Jarvis-style circular HUD — concentric rings, scanning arcs,
 * and expanding ripples that intensify with listening / speaking / processing.
 */
export default function H3roJarvisOrb({
  state,
  size = 200,
  onClick,
  disabled,
  'aria-label': ariaLabel = 'Talk to H3RO',
}: H3roJarvisOrbProps) {
  const active = state !== 'idle'
  const listening = state === 'listening'
  const speaking = state === 'speaking'
  const processing = state === 'processing'
  const markSize = Math.max(14, Math.round(size * 0.11))

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`h3ro-jarvis ${active ? `is-${state}` : 'is-idle'}`}
      style={{
        width: size,
        height: size,
        border: 'none',
        padding: 0,
        background: 'transparent',
        cursor: disabled ? 'wait' : 'pointer',
        position: 'relative',
        flexShrink: 0,
        borderRadius: '50%',
      }}
    >
      {/* Soft bloom behind the HUD */}
      <span className="h3ro-jarvis-bloom" aria-hidden />

      {/* Expanding ripple rings (listening / speaking) */}
      {(listening || speaking) && (
        <>
          <span className="h3ro-jarvis-ripple r1" aria-hidden />
          <span className="h3ro-jarvis-ripple r2" aria-hidden />
          <span className="h3ro-jarvis-ripple r3" aria-hidden />
        </>
      )}

      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        className="h3ro-jarvis-svg"
        aria-hidden
      >
        <defs>
          <radialGradient id="h3roCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(159,222,250,0.55)" />
            <stop offset="45%" stopColor="rgba(159,222,250,0.12)" />
            <stop offset="100%" stopColor="rgba(159,222,250,0)" />
          </radialGradient>
          <linearGradient id="h3roArc" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(159,222,250,0)" />
            <stop offset="40%" stopColor="rgba(159,222,250,0.85)" />
            <stop offset="100%" stopColor="rgba(159,222,250,0)" />
          </linearGradient>
        </defs>

        {/* Core glow disc */}
        <circle cx="100" cy="100" r="52" fill="url(#h3roCore)" className="h3ro-jarvis-core" />

        {/* Tick marks — outer bezel */}
        {Array.from({ length: 60 }).map((_, i) => {
          const major = i % 5 === 0
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2
          const r1 = major ? 88 : 91
          const r2 = 94
          return (
            <line
              key={i}
              x1={100 + Math.cos(a) * r1}
              y1={100 + Math.sin(a) * r1}
              x2={100 + Math.cos(a) * r2}
              y2={100 + Math.sin(a) * r2}
              stroke="rgba(159,222,250,0.35)"
              strokeWidth={major ? 1.2 : 0.6}
              className="h3ro-jarvis-tick"
            />
          )
        })}

        {/* Concentric HUD rings */}
        <circle cx="100" cy="100" r="94" fill="none" stroke="rgba(159,222,250,0.22)" strokeWidth="1" />
        <circle cx="100" cy="100" r="78" fill="none" stroke="rgba(159,222,250,0.38)" strokeWidth="1.2" className="h3ro-jarvis-ring ring-a" />
        <circle cx="100" cy="100" r="64" fill="none" stroke="rgba(159,222,250,0.28)" strokeWidth="0.9" strokeDasharray="3 5" className="h3ro-jarvis-ring ring-b" />
        <circle cx="100" cy="100" r="48" fill="none" stroke="rgba(159,222,250,0.5)" strokeWidth="1.4" className="h3ro-jarvis-ring ring-c" />
        <circle cx="100" cy="100" r="28" fill="none" stroke="rgba(159,222,250,0.55)" strokeWidth="1" className="h3ro-jarvis-ring ring-d" />

        {/* Rotating scan arcs */}
        <g className="h3ro-jarvis-spin spin-fast">
          <path
            d="M100 22 A78 78 0 0 1 178 100"
            fill="none"
            stroke="url(#h3roArc)"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M100 178 A78 78 0 0 1 22 100"
            fill="none"
            stroke="rgba(159,222,250,0.35)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </g>
        <g className="h3ro-jarvis-spin spin-slow">
          <path
            d="M36 64 A64 64 0 0 1 136 36"
            fill="none"
            stroke="rgba(159,222,250,0.65)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="136" cy="36" r="2.2" fill="rgba(159,222,250,0.9)" />
        </g>

        {/* Inner processing spinner (visible when processing) */}
        {processing && (
          <g className="h3ro-jarvis-spin spin-process">
            <circle
              cx="100" cy="100" r="38"
              fill="none"
              stroke="rgba(159,222,250,0.7)"
              strokeWidth="2"
              strokeDasharray="18 40"
              strokeLinecap="round"
            />
          </g>
        )}

        {/* Speaking waveform nodes */}
        {speaking && (
          <g className="h3ro-jarvis-wave">
            {[0, 1, 2, 3, 4].map(i => (
              <rect
                key={i}
                x={82 + i * 8}
                y={94}
                width="3"
                height="12"
                rx="1"
                fill="rgba(159,222,250,0.85)"
                style={{ animationDelay: `${i * 0.08}s` }}
              />
            ))}
          </g>
        )}
      </svg>

      {/* Center wordmark — hidden while speaking waveform shows */}
      {!speaking && (
        <span
          className="h3ro-jarvis-mark"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-archivo), system-ui, sans-serif',
            fontWeight: 700,
            fontSize: markSize,
            letterSpacing: '0.12em',
            color: 'var(--color-ink)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'baseline' }}>
            H
            <Glyph3
              size={`${markSize}px`}
              style={{ marginLeft: 1, marginRight: 1, transform: 'translateY(-0.02em)' }}
            />
            RO
          </span>
        </span>
      )}
    </button>
  )
}
