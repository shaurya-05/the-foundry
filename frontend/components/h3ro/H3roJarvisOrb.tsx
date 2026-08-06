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
 * radar sweeps, and expanding ripples that intensify with voice state.
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
  const markSize = Math.max(16, Math.round(size * 0.13))
  const uid = `h3ro-${size}`

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
      <span className="h3ro-jarvis-bloom" aria-hidden />
      <span className="h3ro-jarvis-bloom bloom-outer" aria-hidden />

      {/* Ripples — always on; denser when active */}
      <span className="h3ro-jarvis-ripple r1" aria-hidden />
      <span className="h3ro-jarvis-ripple r2" aria-hidden />
      <span className="h3ro-jarvis-ripple r3" aria-hidden />
      {(listening || speaking) && (
        <>
          <span className="h3ro-jarvis-ripple r4" aria-hidden />
          <span className="h3ro-jarvis-ripple r5" aria-hidden />
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
          <radialGradient id={`${uid}-core`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(159,222,250,0.7)" />
            <stop offset="35%" stopColor="rgba(159,222,250,0.22)" />
            <stop offset="70%" stopColor="rgba(159,222,250,0.05)" />
            <stop offset="100%" stopColor="rgba(159,222,250,0)" />
          </radialGradient>
          <linearGradient id={`${uid}-arc`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(159,222,250,0)" />
            <stop offset="50%" stopColor="rgba(159,222,250,1)" />
            <stop offset="100%" stopColor="rgba(159,222,250,0)" />
          </linearGradient>
          <linearGradient id={`${uid}-sweep`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(159,222,250,0)" />
            <stop offset="70%" stopColor="rgba(159,222,250,0.15)" />
            <stop offset="100%" stopColor="rgba(159,222,250,0.55)" />
          </linearGradient>
        </defs>

        {/* Core glow */}
        <circle cx="100" cy="100" r="56" fill={`url(#${uid}-core)`} className="h3ro-jarvis-core" />

        {/* Radar wedge sweep */}
        <g className="h3ro-jarvis-spin spin-radar">
          <path
            d="M100 100 L100 12 A88 88 0 0 1 168 40 Z"
            fill={`url(#${uid}-sweep)`}
            className="h3ro-jarvis-radar"
          />
        </g>

        {/* Tick marks — outer bezel, chase pulse */}
        {Array.from({ length: 72 }).map((_, i) => {
          const major = i % 6 === 0
          const a = (i / 72) * Math.PI * 2 - Math.PI / 2
          const r1 = major ? 87 : 90.5
          const r2 = 95
          return (
            <line
              key={i}
              x1={100 + Math.cos(a) * r1}
              y1={100 + Math.sin(a) * r1}
              x2={100 + Math.cos(a) * r2}
              y2={100 + Math.sin(a) * r2}
              stroke="rgba(159,222,250,0.4)"
              strokeWidth={major ? 1.4 : 0.55}
              className="h3ro-jarvis-tick"
              style={{ animationDelay: `${(i / 72) * 2.4}s` }}
            />
          )
        })}

        {/* Concentric HUD rings */}
        <circle cx="100" cy="100" r="95" fill="none" stroke="rgba(159,222,250,0.25)" strokeWidth="1" />
        <circle cx="100" cy="100" r="82" fill="none" stroke="rgba(159,222,250,0.45)" strokeWidth="1.3" className="h3ro-jarvis-ring ring-a" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(159,222,250,0.22)" strokeWidth="0.8" strokeDasharray="2 4" className="h3ro-jarvis-ring ring-dash-cw" />
        <circle cx="100" cy="100" r="58" fill="none" stroke="rgba(159,222,250,0.4)" strokeWidth="1.1" strokeDasharray="8 6 2 6" className="h3ro-jarvis-ring ring-dash-ccw" />
        <circle cx="100" cy="100" r="46" fill="none" stroke="rgba(159,222,250,0.55)" strokeWidth="1.5" className="h3ro-jarvis-ring ring-c" />
        <circle cx="100" cy="100" r="32" fill="none" stroke="rgba(159,222,250,0.35)" strokeWidth="1" className="h3ro-jarvis-ring ring-d" />

        {/* Orbiting nodes */}
        <g className="h3ro-jarvis-spin spin-orbit">
          <circle cx="100" cy="18" r="2.5" fill="rgba(159,222,250,0.95)" className="h3ro-jarvis-node" />
          <circle cx="182" cy="100" r="1.8" fill="rgba(159,222,250,0.7)" />
          <circle cx="100" cy="182" r="2.2" fill="rgba(159,222,250,0.85)" className="h3ro-jarvis-node" />
        </g>
        <g className="h3ro-jarvis-spin spin-orbit-rev">
          <circle cx="42" cy="42" r="2" fill="rgba(159,222,250,0.8)" />
          <circle cx="158" cy="158" r="1.6" fill="rgba(159,222,250,0.65)" />
        </g>

        {/* Rotating scan arcs */}
        <g className="h3ro-jarvis-spin spin-fast">
          <path
            d="M100 18 A82 82 0 0 1 182 100"
            fill="none"
            stroke={`url(#${uid}-arc)`}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M100 182 A82 82 0 0 1 18 100"
            fill="none"
            stroke="rgba(159,222,250,0.4)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
        <g className="h3ro-jarvis-spin spin-mid">
          <path
            d="M30 70 A70 70 0 0 1 130 30"
            fill="none"
            stroke="rgba(159,222,250,0.75)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="130" cy="30" r="2.4" fill="rgba(159,222,250,1)" className="h3ro-jarvis-node" />
        </g>
        <g className="h3ro-jarvis-spin spin-slow">
          <path
            d="M160 60 A58 58 0 0 1 160 140"
            fill="none"
            stroke="rgba(159,222,250,0.5)"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </g>

        {/* Processing spinner */}
        {processing && (
          <g className="h3ro-jarvis-spin spin-process">
            <circle
              cx="100" cy="100" r="38"
              fill="none"
              stroke="rgba(159,222,250,0.85)"
              strokeWidth="2.2"
              strokeDasharray="12 8 4 20"
              strokeLinecap="round"
            />
          </g>
        )}

        {/* Speaking waveform — denser bars */}
        {speaking && (
          <g className="h3ro-jarvis-wave">
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <rect
                key={i}
                x={78 + i * 6.5}
                y={92}
                width="3.2"
                height="16"
                rx="1.2"
                fill="rgba(159,222,250,0.9)"
                style={{ animationDelay: `${i * 0.07}s` }}
              />
            ))}
          </g>
        )}

        {/* Listening ping flashes */}
        {listening && (
          <circle
            cx="100" cy="100" r="42"
            fill="none"
            stroke="rgba(159,222,250,0.8)"
            strokeWidth="1.5"
            className="h3ro-jarvis-ping"
          />
        )}
      </svg>

      {/* Center wordmark — Glyph3 at 1em to match H/RO letter size */}
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
            lineHeight: 1,
            letterSpacing: '0.06em',
            color: 'var(--color-ink)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.02em' }}>
            <span>H</span>
            <Glyph3
              size="1em"
              color="var(--color-ink)"
              style={{ display: 'inline-block', verticalAlign: 'middle' }}
            />
            <span>RO</span>
          </span>
        </span>
      )}
    </button>
  )
}
