/**
 * H3rosWordmark — the parent-brand identity. h + Signal-orange Glyph3 + ros.
 *
 * Used in footers, "by h3ros" lockups, and the parent-brand link in nav.
 * Set lowercase per h3ros canon.
 */
import Glyph3 from './Glyph3'

type Size = 'xs' | 'sm' | 'md'

const SIZE_MAP: Record<Size, { fontSize: number; tracking: string; gap: string }> = {
  xs: { fontSize: 10, tracking: '-0.02em', gap: '0.03em' },
  sm: { fontSize: 14, tracking: '-0.03em', gap: '0.03em' },
  md: { fontSize: 18, tracking: '-0.03em', gap: '0.03em' },
}

type WordmarkProps = {
  size?: Size
  inverted?: boolean
  className?: string
  style?: React.CSSProperties
}

export default function H3rosWordmark({
  size = 'sm',
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
      aria-label="h3ros"
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        fontFamily: 'var(--font-archivo-black), sans-serif',
        fontWeight: 400,
        fontSize: cfg.fontSize,
        lineHeight: 1,
        letterSpacing: cfg.tracking,
        color: textColor,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span>h</span>
      <Glyph3
        color="var(--color-signal)"
        size="0.72em"
        style={{ marginLeft: cfg.gap, marginRight: cfg.gap, transform: 'translateY(-0.01em)' }}
      />
      <span>ros</span>
    </span>
  )
}
