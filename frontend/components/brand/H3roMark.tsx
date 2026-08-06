/**
 * H3roMark — H + Arc Cyan Glyph3 + RO, matching FOUND3RY logo treatment.
 * Glyph is Arc Cyan (#4B9FFF token) and sized to the letter cap-height.
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

/** Cap-height ratio vs font-size for Archivo Bold — matches Found3ryWordmark look. */
const CAP = 0.68

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
        alignItems: 'center',
        gap: 0,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-archivo-black), var(--font-archivo), system-ui, sans-serif',
        fontWeight: 400,
        color: 'var(--color-ink)',
        ...style,
      }}
    >
      <span>H</span>
      <Glyph3
        size={size * CAP}
        color={glyphColor}
        style={{ marginLeft: '0.04em', marginRight: '0.04em' }}
      />
      <span>RO</span>
    </span>
  )
}
