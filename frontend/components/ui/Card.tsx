/**
 * Card — H3ROS replacement for GlassCard.
 *
 * Vellum surface, hairline border, zero radius by default, no shadow, no
 * gradient. Hover lightens to Off-White via transition-colors only.
 *
 * Variants:
 *   - default:   flat Vellum surface, 0 radius
 *   - bordered:  hairline border (default)
 *   - chassis:   inside a SpecialistGrid — no own border (grid gap is the line)
 *
 * Accent variant adds a 1.5px Arc Cyan top or left bar — used sparingly
 * (featured pricing tier, active item).
 */
import { CSSProperties, ReactNode, MouseEvent } from 'react'

type CardProps = {
  children: ReactNode
  /** Render hover background change (off-white). Default true. */
  hover?: boolean
  /** Add a 1.5px Arc Cyan bar on the top or left edge. */
  accent?: 'top' | 'left'
  /** Use inside SpecialistGrid: drops own border, lets grid gap separate. */
  chassis?: boolean
  /** Visual padding scale. */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** Optional onClick (renders as button). */
  onClick?: (e: MouseEvent<HTMLDivElement>) => void
  /** Optional className. */
  className?: string
  /** Optional inline style overrides. */
  style?: CSSProperties
}

const PADDING_MAP: Record<NonNullable<CardProps['padding']>, string> = {
  none: '0',
  sm: '16px',
  md: '24px',
  lg: '32px',
}

export default function Card({
  children,
  hover = true,
  accent,
  chassis = false,
  padding = 'md',
  onClick,
  className,
  style,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={className}
      style={{
        position: 'relative',
        backgroundColor: 'var(--color-vellum)',
        border: chassis ? 'none' : '1px solid var(--color-n200)',
        borderRadius: 0,
        padding: PADDING_MAP[padding],
        cursor: onClick ? 'pointer' : undefined,
        transition: hover ? 'background-color var(--duration-base, 200ms) var(--ease-out, ease-out)' : undefined,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (hover) e.currentTarget.style.backgroundColor = 'var(--color-off-white)'
      }}
      onMouseLeave={(e) => {
        if (hover) e.currentTarget.style.backgroundColor = 'var(--color-vellum)'
      }}
    >
      {accent === 'top' && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: 1.5,
            backgroundColor: 'var(--color-arc-cyan)',
          }}
        />
      )}
      {accent === 'left' && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0,
            width: 1.5,
            backgroundColor: 'var(--color-arc-cyan)',
          }}
        />
      )}
      {children}
    </div>
  )
}
