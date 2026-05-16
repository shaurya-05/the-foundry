/**
 * Crease — a single 0.5px Arc Cyan hairline.
 *
 * Equity layer 2 (Pininfarina). Appears below hero wordmarks and between
 * major page sections. NEVER under every heading (that's the banned
 * "accent line under titles" pattern).
 *
 * Renders as scaleY(0.5) to produce a true hairline at any DPR while
 * keeping the original element 1px tall in layout flow.
 */
type CreaseProps = {
  /** Color override. Default Arc Cyan. Use 'signal' tone only for parent-brand zones. */
  color?: string
  /** Horizontal inset in px on each side. Default 0 (full width of parent). */
  inset?: number
  /** Optional className. */
  className?: string
  /** Optional style overrides. */
  style?: React.CSSProperties
}

export default function Crease({
  color = 'var(--color-arc-cyan)',
  inset = 0,
  className,
  style,
}: CreaseProps) {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={className}
      style={{
        width: inset ? `calc(100% - ${inset * 2}px)` : '100%',
        height: 1,
        marginLeft: inset || undefined,
        backgroundColor: color,
        opacity: 0.6,
        transformOrigin: 'left center',
        transform: 'scaleY(0.5)',
        ...style,
      }}
    />
  )
}
