/**
 * Glyph3 — the custom drawn `3` glyph that anchors the h3ros identity system.
 *
 * Geometry: four hard-edge rectangles, right-side spine, recessed middle bar.
 * The same glyph anchors every vertical wordmark: T3RRA, FOUND3RY, HERM3S,
 * CR3ATE — never typeset as an E.
 *
 * Proportion note: h3ros source DrawnThree uses bar=28 / gap=29 (roughly 1:1).
 * That renders identically at large sizes but at inline body-text scale the
 * bars get sub-pixel crushed by AA and look thinner than the gaps. We thicken
 * the bars to bar=34 / gap=20 (≈ 1.7:1) so the visual reads cleanly at every
 * scale and matches the canonical h3ros wordmark renders shown on h3ros.com.
 *
 * Spec:
 *   viewBox  0 0 110 142   (aspect ≈ 0.775)
 *   shape    4 rects: top bar (h=34), middle bar (h=34, recessed 15px left),
 *            bottom bar (h=34), right spine (w=28, full height)
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
      <rect x="0"  y="0"   width="110" height="34" />
      <rect x="15" y="54"  width="95"  height="34" />
      <rect x="0"  y="108" width="110" height="34" />
      <rect x="82" y="0"   width="28"  height="142" />
    </svg>
  )
}
