/**
 * DotGrid — equity layer 1 (Braun substrate).
 *
 * Renders a subtle dot grid background, applied to hero and dark CTA
 * sections. NEVER a wallpaper across whole pages — reserved for *hero*
 * texture.
 */
import { ReactNode } from 'react'

type DotGridProps = {
  /** light = dark dots on off-white; dark = light dots on ink. */
  tone?: 'light' | 'dark'
  /** Spacing between dots in px. Default 16. */
  density?: number
  /** Opacity of the dot fill. Defaults: 0.10. */
  opacity?: number
  /** Optional className. */
  className?: string
  /** Optional inline style. */
  style?: React.CSSProperties
  children?: ReactNode
}

export default function DotGrid({
  tone = 'light',
  density = 16,
  opacity = 0.1,
  className,
  style,
  children,
}: DotGridProps) {
  const dotRgba = tone === 'dark'
    ? `rgba(242, 242, 238, ${opacity})`
    : `rgba(20, 20, 19, ${opacity})`
  const surfaceColor = tone === 'dark' ? 'var(--color-ink)' : 'var(--color-off-white)'
  return (
    <div
      data-dotgrid={tone}
      className={className}
      style={{
        backgroundColor: surfaceColor,
        backgroundImage: `radial-gradient(circle, ${dotRgba} 0.8px, transparent 1px)`,
        backgroundSize: `${density}px ${density}px`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
