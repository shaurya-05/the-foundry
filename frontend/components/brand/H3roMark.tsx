/**
 * H3roMark — H + Arc Cyan Glyph3 + RO, matching FOUND3RY logo treatment.
 * Glyph uses the same Arc Cyan and 0.72em cap-height as Found3ryWordmark.
 */
import Glyph3 from './Glyph3'

type H3roMarkProps = {
  /** Font size in px for surrounding letters. */
  size?: number
  /** Override glyph fill. Default: Found3ry Arc Cyan. */
  glyphColor?: string
  className?: string
  style?: React.CSSProperties
}

export default function H3roMark({
  size = 14,
  glyphColor = 'var(--color-arc-cyan)',
  className,
  style,
}: H3roMarkProps) {
  return (
    <span
      className={className}
      role="img"
      aria-label="H3RO"
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-archivo), system-ui, sans-serif',
        fontWeight: 700,
        ...style,
      }}
    >
      <span>H</span>
      <Glyph3
        size="0.72em"
        color={glyphColor}
        style={{ marginLeft: '0.02em', marginRight: '0.02em', transform: 'translateY(-0.01em)' }}
      />
      <span>RO</span>
    </span>
  )
}
