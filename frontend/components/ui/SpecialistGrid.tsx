/**
 * SpecialistGrid — chassis-effect grid for tile collections.
 *
 * Uses `gap: 1px` against an n200 background so the hairlines between cells
 * are drawn by the gap itself rather than per-cell borders. Children should
 * pass `chassis` to <Card/> so they don't draw their own borders.
 *
 * Used for the four-specialist showcase, pricing tiers, agent grids, etc.
 */
import { ReactNode } from 'react'

type SpecialistGridProps = {
  children: ReactNode
  /** Number of columns (mobile collapses to 1 below md breakpoint). */
  columns?: 1 | 2 | 3 | 4
  /** Optional className. */
  className?: string
  /** Optional style. */
  style?: React.CSSProperties
}

export default function SpecialistGrid({
  children,
  columns = 4,
  className,
  style,
}: SpecialistGridProps) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 1,
        backgroundColor: 'var(--color-n200)',
        border: '1px solid var(--color-n200)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
