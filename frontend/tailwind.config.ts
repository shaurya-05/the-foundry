import type { Config } from 'tailwindcss'

const config: Config = {
  // Light theme only — no dark mode
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ─── H3ROS Design Language v1.2 ─────────────────────────────────
        ink:           '#141413',
        'off-white':   '#F2F2EE',
        vellum:        '#E8E5DD',
        signal:        '#E84A0E',
        'arc-cyan': {
          DEFAULT: '#9FDEFA',
          deep:    '#6BBFD9',
        },
        n: {
          900: '#141413',
          600: '#5F5F5A',
          400: '#9C9C95',
          200: '#D1D1CB',
          100: '#E8E5DD',
        },
        // ─── Legacy (Phase 4–6 will prune the unused ones) ──────────────
        // Accents (still consumed by Sidebar/Header per-section colors until Phase 3)
        'accent-red':    '#FF3B3B',
        'accent-blue':   '#3ABEFF',
        'accent-orange': '#FF8A2A',
        'accent-green':  '#38D37A',
        'accent-purple': '#A78BFA',
        'accent-teal':   '#22D3EE',
        // Text aliases (CSS vars carry the real semantics now)
        'text-primary':   '#EEF2FF',
        'text-secondary': '#B2BCCF',
        'text-muted':     '#637080',
        'text-subtle':    '#303D4E',
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
