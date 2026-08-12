'use client'

import { useEffect, useState } from 'react'
import {
  isSpeechRecognitionSupported,
  readAlwaysListeningPreference,
  writeAlwaysListeningPreference,
} from '@/lib/voice'

/**
 * Opt-in always-listening (wake-word) preference — shared localStorage key
 * with the H3RO voice stage "Always" chip.
 */
export default function AlwaysListeningSettings() {
  const [supported, setSupported] = useState(false)
  const [on, setOn] = useState(false)

  useEffect(() => {
    setSupported(isSpeechRecognitionSupported())
    setOn(readAlwaysListeningPreference())
  }, [])

  if (!supported) {
    return (
      <div style={{ padding: '4px 0 8px', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-archivo)', lineHeight: 1.45 }}>
        Always listening needs Web Speech recognition in this browser. Push-to-talk and typing still work.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-archivo)', lineHeight: 1.45, maxWidth: 560 }}>
        Keep the microphone open and only send a turn after you say “Hey H3RO” or “Hey hero”.
        Off by default. When on, the orb shows an amber <strong>mic hot</strong> state so you always know audio is being captured.
        Saying the wake word while H3RO is speaking can interrupt the reply — works best with headphones so the mic isn’t fighting the speakers.
      </div>
      <label style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        fontFamily: 'var(--font-ibm-plex-mono)',
        fontSize: 12,
        letterSpacing: '0.04em',
        color: 'var(--text-primary)',
      }}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.target.checked
            setOn(next)
            writeAlwaysListeningPreference(next)
          }}
          style={{ width: 16, height: 16, accentColor: '#C47A1A' }}
        />
        Always listening (wake word)
      </label>
    </div>
  )
}
