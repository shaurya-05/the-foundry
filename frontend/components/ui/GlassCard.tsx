import { CSSProperties, ReactNode } from 'react'
import { clsx } from 'clsx'

interface GlassCardProps {
  children: ReactNode
  tier?: 0 | 1 | 2 | 3
  className?: string
  style?: CSSProperties
  accent?: string
  accentTop?: boolean
  accentGlow?: boolean
  onClick?: (e?: React.MouseEvent) => void
  hover?: boolean
}

export default function GlassCard({
  children,
  tier = 1,
  className,
  style,
  accent,
  accentTop = false,
  accentGlow = false,
  onClick,
  hover = false,
}: GlassCardProps) {
  return (
    <div
      className={clsx(`gl${tier}`, hover && 'lift', className)}
      onClick={onClick}
      style={{
        position: 'relative',
        ...(accentGlow && accent ? {
          boxShadow: `0 0 0 1px ${accent}22, 0 2px 12px ${accent}10, 0 4px 16px rgba(0,0,0,0.06)`,
        } : {}),
        ...style,
        cursor: onClick ? 'pointer' : style?.cursor,
      }}
    >
      {/* Top accent bar with glow */}
      {accent && accentTop && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, transparent 0%, ${accent} 20%, ${accent} 80%, transparent 100%)`,
            borderRadius: '10px 10px 0 0',
            ...(accentGlow ? { boxShadow: `0 0 12px ${accent}80, 0 0 4px ${accent}60` } : {}),
          }}
        />
      )}
      {/* Left accent bar with glow */}
      {accent && !accentTop && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: 0,
            bottom: 4,
            width: 2,
            background: `linear-gradient(180deg, transparent 0%, ${accent} 15%, ${accent} 85%, transparent 100%)`,
            borderRadius: '10px 0 0 10px',
            ...(accentGlow ? { boxShadow: `0 0 10px ${accent}60` } : {}),
          }}
        />
      )}
      {children}
    </div>
  )
}
