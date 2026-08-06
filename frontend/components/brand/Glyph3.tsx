/**
 * Glyph3 — the custom drawn `3` glyph that anchors the h3ros identity system.
 *
 * Geometry: four hard-edge rectangles, right-side spine, recessed middle bar.
 * The same glyph anchors every vertical wordmark: T3RRA, FOUND3RY, HERM3S,
 * CR3ATE — never typeset as an E.
 *
 * Spec:
 *   viewBox  0 0 110 142   (aspect ≈ 0.775)
 *   color    FOUND3RY uses Arc Cyan; h3ros parent uses Signal Orange
 *
 * Sized by `size` prop. Prefer a pixel number from the parent font size
 * (e.g. size * 0.68) so width/height never depend on CSS calc(em * n).
 * Fill is set on each rect so parent `color` / currentColor cannot wash it out.
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

const ASPECT = 110 / 142

export default function Glyph3({
  color = 'var(--color-arc-cyan)',
  size = '0.68em',
  ariaLabel,
  className,
  style,
}: Glyph3Props) {
  const isPx = typeof size === 'number'
  const heightPx = isPx ? size : undefined
  const widthPx = isPx ? size * ASPECT : undefined
  const heightCss = isPx ? undefined : size
  const { fill: _f, ...restStyle } = (style || {}) as React.CSSProperties & { fill?: string }
  void _f

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 110 142"
      preserveAspectRatio="xMidYMid meet"
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      className={className}
      width={widthPx}
      height={heightPx}
      style={{
        display: 'inline-block',
        height: heightCss,
        width: isPx ? undefined : 'auto',
        aspectRatio: '110 / 142',
        flexShrink: 0,
        overflow: 'visible',
        ...restStyle,
      }}
    >
      <rect fill={color} x="0"  y="0"   width="110" height="34" />
      <rect fill={color} x="15" y="54"  width="95"  height="34" />
      <rect fill={color} x="0"  y="108" width="110" height="34" />
      <rect fill={color} x="82" y="0"   width="28"  height="142" />
    </svg>
  )
}
