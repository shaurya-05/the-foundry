/**
 * Found3ryWordmark — the canonical FOUND3RY identity render.
 *
 * Renders THE FOUND + <Glyph3 color="arc-cyan"/> + RY in Archivo Black.
 * NEVER use a typed `3` for this wordmark — always the drawn glyph.
 */
import Glyph3 from './Glyph3'

type Size = 'sm' | 'md' | 'lg' | 'hero'

const SIZE_MAP: Record<Size, { fontSize: number; tracking: string; gap: string }> = {
  sm:   { fontSize: 16, tracking: '-0.02em', gap: '0.04em' },
  md:   { fontSize: 18, tracking: '-0.02em', gap: '0.04em' },
  lg:   { fontSize: 32, tracking: '-0.03em', gap: '0.04em' },
  hero: { fontSize: 96, tracking: '-0.04em', gap: '0.04em' },
}

type WordmarkProps = {
  /** Visual size preset. */
  size?: Size
  /** Render on a dark surface (flips text color from Ink → Off-White). */
  inverted?: boolean
  /** Optional className for layout. */
  className?: string
  /** Optional style overrides. */
  style?: React.CSSProperties
}

export default function Found3ryWordmark({
  size = 'md',
  inverted = false,
  className,
  style,
}: WordmarkProps) {
  const cfg = SIZE_MAP[size]
  const textColor = inverted ? 'var(--color-off-white)' : 'var(--color-ink)'
  return (
    <span
      className={className}
      role="img"
      aria-label="THE FOUND3RY"
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        fontFamily: 'var(--font-archivo-black), sans-serif',
        fontWeight: 400, // Archivo Black is a single-weight family
        fontSize: cfg.fontSize,
        lineHeight: 1,
        letterSpacing: cfg.tracking,
        color: textColor,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span>THE FOUND</span>
      <Glyph3
        color="var(--color-arc-cyan)"
        size="0.72em"
        style={{ marginLeft: cfg.gap, marginRight: cfg.gap, transform: 'translateY(-0.01em)' }}
      />
      <span>RY</span>
    </span>
  )
}
