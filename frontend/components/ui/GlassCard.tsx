/**
 * GlassCard — DEPRECATED legacy wrapper.
 *
 * Now a thin adapter over <Card/> from the H3ROS Design Language. Old
 * props that don't map (tier, accentTop, accentGlow) are ignored to avoid
 * forcing 10 page-client rewrites. The visual output is the new H3ROS
 * Vellum-surface + hairline-border + no-shadow + zero-radius card.
 *
 * Phase 6 will rename remaining consumers from GlassCard to Card and
 * delete this file.
 */
import { CSSProperties, ReactNode, MouseEvent } from 'react'
import Card from './Card'

interface GlassCardProps {
  children: ReactNode
  /** @deprecated kept for API compatibility; ignored. */
  tier?: 0 | 1 | 2 | 3
  className?: string
  style?: CSSProperties
  /** Accent color — only used to set Arc Cyan top/left bar. */
  accent?: string
  /** Render accent on top edge (true) or left edge (false). */
  accentTop?: boolean
  /** @deprecated glows are forbidden in H3ROS; ignored. */
  accentGlow?: boolean
  onClick?: (e?: MouseEvent<HTMLDivElement>) => void
  hover?: boolean
}

export default function GlassCard({
  children,
  className,
  style,
  accent,
  accentTop = false,
  onClick,
  hover = false,
}: GlassCardProps) {
  // Map legacy accent (any color) into H3ROS Arc Cyan accent bar.
  // The original allowed arbitrary accent colors; H3ROS reserves color
  // distinction for the wordmark glyph + Arc Cyan signature only.
  const accentVariant = accent ? (accentTop ? 'top' : 'left') : undefined
  return (
    <Card
      accent={accentVariant}
      hover={hover}
      padding="none"
      className={className}
      style={style}
      onClick={onClick}
    >
      {children}
    </Card>
  )
}
