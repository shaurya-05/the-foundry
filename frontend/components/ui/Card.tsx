/**
 * Card — frosted bay panel (semi-transparent so the darker floor shows through).
 */
import { CSSProperties, ReactNode, MouseEvent } from 'react'

type CardProps = {
  children: ReactNode
  hover?: boolean
  accent?: 'top' | 'left'
  chassis?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: (e: MouseEvent<HTMLDivElement>) => void
  className?: string
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
      className={`bay-panel ${hover ? 'liquid-glass-interactive' : ''} ${className || ''}`.trim()}
      style={{
        position: 'relative',
        /* Let .bay-panel CSS handle frost fill — don't override with opaque color */
        border: chassis ? 'none' : undefined,
        borderRadius: chassis ? 0 : undefined,
        padding: PADDING_MAP[padding],
        cursor: onClick || hover ? 'pointer' : undefined,
        boxShadow: chassis ? 'none' : undefined,
        /* Keep shadows visible — don't clip with overflow:hidden */
        ...style,
      }}
    >
      {accent === 'top' && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: 2,
            backgroundColor: 'var(--color-arc-cyan)',
            borderRadius: '16px 16px 0 0',
            zIndex: 1,
          }}
        />
      )}
      {accent === 'left' && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0,
            width: 2,
            backgroundColor: 'var(--color-arc-cyan)',
            zIndex: 1,
          }}
        />
      )}
      {children}
    </div>
  )
}
