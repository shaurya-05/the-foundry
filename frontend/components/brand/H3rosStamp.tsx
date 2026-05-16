/**
 * H3rosStamp — the lone Signal-orange Glyph3 used as the parent-brand
 * confirmation moment, typically pinned top-right of the navigation bar.
 *
 * Once per page. Never repeated. Never decorative.
 */
import Glyph3 from './Glyph3'

type StampProps = {
  /** Glyph height in px. Default 16. */
  size?: number
  /** Optional onClick to link to h3ros.com. */
  onClick?: () => void
  /** Accessible label. */
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
}

export default function H3rosStamp({
  size = 16,
  onClick,
  ariaLabel = 'h3ros parent brand',
  className,
  style,
}: StampProps) {
  const inner = (
    <Glyph3
      color="var(--color-signal)"
      size={size}
      ariaLabel={ariaLabel}
    />
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={className}
        aria-label={ariaLabel}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          opacity: 0.7,
          transition: `opacity var(--duration-fast, 120ms) var(--ease-out, ease-out)`,
          ...style,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
      >
        {inner}
      </button>
    )
  }
  return (
    <span className={className} style={{ display: 'inline-flex', opacity: 0.7, ...style }}>
      {inner}
    </span>
  )
}
