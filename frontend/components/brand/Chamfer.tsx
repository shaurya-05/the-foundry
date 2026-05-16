/**
 * Chamfer — a small 1.5px L-shaped corner mark in Arc Cyan.
 *
 * Equity layer 4 (Ive edge). Pinned to a corner of dark hero or CTA
 * containers to signal "this is a designed surface." Parent container
 * must be `position: relative` for the chamfer to anchor.
 */
type ChamferProps = {
  /** Which corner to pin to. */
  corner?: 'tl' | 'tr' | 'bl' | 'br'
  /** Length of each leg in px. Default 24. */
  size?: number
  /** Distance from the corner in px. Default 0. */
  inset?: number
  /** Stroke thickness in px. Default 1.5. */
  thickness?: number
  /** Color override. Default Arc Cyan. */
  color?: string
}

export default function Chamfer({
  corner = 'tl',
  size = 24,
  inset = 0,
  thickness = 1.5,
  color = 'var(--color-arc-cyan)',
}: ChamferProps) {
  const positionMap: Record<typeof corner, React.CSSProperties> = {
    tl: { top: inset, left: inset },
    tr: { top: inset, right: inset },
    bl: { bottom: inset, left: inset },
    br: { bottom: inset, right: inset },
  }
  // Each L is two divs: a horizontal leg and a vertical leg.
  // Their relative positions flip depending on which corner anchors them.
  const horizontalStyle: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: thickness,
    backgroundColor: color,
    ...(corner === 'tl' || corner === 'tr' ? { top: 0 } : { bottom: 0 }),
    ...(corner === 'tl' || corner === 'bl' ? { left: 0 } : { right: 0 }),
  }
  const verticalStyle: React.CSSProperties = {
    position: 'absolute',
    width: thickness,
    height: size,
    backgroundColor: color,
    ...(corner === 'tl' || corner === 'tr' ? { top: 0 } : { bottom: 0 }),
    ...(corner === 'tl' || corner === 'bl' ? { left: 0 } : { right: 0 }),
  }
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', width: size, height: size, pointerEvents: 'none', ...positionMap[corner] }}
    >
      <div style={horizontalStyle} />
      <div style={verticalStyle} />
    </div>
  )
}
