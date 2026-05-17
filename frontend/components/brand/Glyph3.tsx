/**
 * Glyph3 — the custom drawn `3` glyph that anchors the h3ros identity system.
 *
 * Geometry locked to the canonical h3ros DrawnThree (h3ros-com/components/brand/
 * DrawnThree.tsx). Four hard-edge rectangles, right-side spine, recessed middle
 * bar. The same glyph anchors every vertical wordmark: T3RRA, FOUND3RY, HERM3S,
 * CR3ATE — never typeset as an E.
 *
 * Spec:
 *   viewBox  0 0 110 142   (aspect ≈ 0.775, matches h3ros canon)
 *   shape    4 rects: top bar, recessed middle bar, bottom bar, right spine
 *   color    FOUND3RY uses Arc Cyan; h3ros parent uses Signal Orange
 *
 * Sized by `size` prop. For inline use beside text, callers should pass a value
 * approximately equal to the cap-height of the surrounding type (≈ 0.72em).
 */
type Glyph3Props = {
  /** Fill color. Default: Arc Cyan token. */
  color?: string
  /** Height in pixels or any CSS length. Width auto-scales to maintain aspect. */
  size?: number | string
  /** Accessibility: present as labeled image, else decorative (default). */
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
}

// Aspect: 110 / 142 ≈ 0.7746
const ASPECT = 110 / 142

export default function Glyph3({
  color = 'var(--color-arc-cyan)',
  size = '0.72em',
  ariaLabel,
  className,
  style,
}: Glyph3Props) {
  const height = typeof size === 'number' ? `${size}px` : size
  const width = `calc(${height} * ${ASPECT})`
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 110 142"
      preserveAspectRatio="xMidYMid meet"
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      className={className}
      style={{
        display: 'inline-block',
        height,
        width,
        flexShrink: 0,
        fill: color,
        ...style,
      }}
    >
      <rect x="0"  y="0"   width="110" height="28" />
      <rect x="15" y="57"  width="95"  height="28" />
      <rect x="0"  y="114" width="110" height="28" />
      <rect x="82" y="0"   width="28"  height="142" />
    </svg>
  )
}
