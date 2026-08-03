import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ─── FOUND3RY command center (CSS vars are source of truth) ─────
        ink:           'var(--color-ink)',
        'off-white':   'var(--color-off-white)',
        vellum:        'var(--color-vellum)',
        signal:        'var(--color-signal)',
        'arc-cyan': {
          DEFAULT: 'var(--color-arc-cyan)',
          deep:    'var(--color-arc-cyan-deep)',
        },
        n: {
          900: 'var(--color-n900)',
          600: 'var(--color-n600)',
          400: 'var(--color-n400)',
          300: 'var(--color-n300)',
          200: 'var(--color-n200)',
          100: 'var(--color-n100)',
        },
        // ─── Legacy (Phase 4–6 will prune) ──────────────────────────────
        'accent-red':    'var(--color-signal)',
        'accent-blue':   'var(--color-arc-cyan)',
        'accent-orange': 'var(--color-signal)',
        'accent-green':  'var(--color-arc-cyan-deep)',
        'accent-purple': 'var(--color-arc-cyan-deep)',
        'accent-teal':   'var(--color-arc-cyan)',
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted':     'var(--text-muted)',
        'text-subtle':    'var(--text-subtle)',
      },
      fontFamily: {
        // ─── H3ROS type stack ───────────────────────────────────────────
        'display-black': ['var(--font-archivo-black)', 'sans-serif'],
        editorial:       ['var(--font-plex-serif)', 'serif'],
        ui:              ['var(--font-archivo)', 'system-ui', 'sans-serif'],
        // ─── Legacy aliases (kept; Phase 6 drops Barlow) ────────────────
        display: ['var(--font-barlow-condensed)', 'sans-serif'],
        body:    ['var(--font-barlow)', 'sans-serif'],
        mono:    ['var(--font-ibm-plex-mono)', 'monospace'],
      },
      backdropBlur: {
        'gl0': '20px',
        'gl1': '30px',
        'gl2': '34px',
        'gl3': '40px',
      },
      animation: {
        'pulse-slow': 'pulse 2s ease-in-out infinite',
        'ring-out': 'ring-out 2s ease-out infinite',
        'blink-cursor': 'blink 1s step-end infinite',
        'fade-up': 'fadeUp 0.3s ease-out',
      },
      keyframes: {
        'ring-out': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(2)', opacity: '0' },
        },
        'fadeUp': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}

export default config
