/**
 * Button — H3ROS CTA primitive.
 *
 * Variants:
 *   - primary: Arc Cyan fill + Ink text. Hover → Arc-Cyan-Deep.
 *   - ghost:   Transparent + Ink border + Ink text. Hover → Ink fill + Off-White text.
 *   - link:    Text-only with Arc Cyan underline. Hover → Arc-Cyan-Deep.
 *
 * The trailing arrow (→ U+2192) is the brand's CTA signature.
 */
import { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'link'
type Size = 'sm' | 'md' | 'lg'

type ButtonProps = {
  children: ReactNode
  variant?: Variant
  size?: Size
  /** Append the brand arrow (→) at the end. Default true for primary/ghost. */
  arrow?: boolean
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

const SIZE_MAP: Record<Size, { padding: string; fontSize: number }> = {
  sm: { padding: '8px 14px',  fontSize: 13 },
  md: { padding: '11px 20px', fontSize: 15 },
  lg: { padding: '14px 28px', fontSize: 17 },
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  arrow,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const sizeCfg = SIZE_MAP[size]
  const showArrow = arrow ?? variant !== 'link'

  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontFamily: 'var(--font-archivo), system-ui, sans-serif',
    fontWeight: 700,
    fontSize: sizeCfg.fontSize,
    lineHeight: 1.2,
    padding: variant === 'link' ? 0 : sizeCfg.padding,
    border: variant === 'ghost' ? '1px solid var(--color-ink)' : 'none',
    borderRadius: variant === 'link' ? 0 : 2,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out), color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
    whiteSpace: 'nowrap',
  }

  const variantStyle: React.CSSProperties =
    variant === 'primary' ? {
      backgroundColor: 'var(--color-arc-cyan)',
      color: 'var(--color-ink)',
    }
    : variant === 'ghost' ? {
      backgroundColor: 'transparent',
      color: 'var(--color-ink)',
    }
    : { // link
      backgroundColor: 'transparent',
      color: 'var(--color-ink)',
      textDecoration: 'underline',
      textDecorationColor: 'var(--color-arc-cyan)',
      textUnderlineOffset: '0.2em',
      textDecorationThickness: '1px',
    }

  return (
    <button
      disabled={disabled}
      {...rest}
      style={{ ...base, ...variantStyle, ...style }}
      onMouseEnter={(e) => {
        if (disabled) return
        if (variant === 'primary') {
          e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan-deep)'
        } else if (variant === 'ghost') {
          e.currentTarget.style.backgroundColor = 'var(--color-ink)'
          e.currentTarget.style.color = 'var(--color-off-white)'
        } else if (variant === 'link') {
          e.currentTarget.style.color = 'var(--color-arc-cyan-deep)'
        }
        rest.onMouseEnter?.(e)
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        if (variant === 'primary') {
          e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan)'
        } else if (variant === 'ghost') {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--color-ink)'
        } else if (variant === 'link') {
          e.currentTarget.style.color = 'var(--color-ink)'
        }
        rest.onMouseLeave?.(e)
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = '1px solid var(--color-arc-cyan)'
        e.currentTarget.style.outlineOffset = '2px'
        rest.onFocus?.(e)
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = 'none'
        rest.onBlur?.(e)
      }}
    >
      <span>{children}</span>
      {showArrow && <span aria-hidden="true">→</span>}
    </button>
  )
}
