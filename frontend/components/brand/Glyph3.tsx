/**
 * Glyph3 — the custom drawn `3` glyph that anchors the h3ros identity system.
 *
 * Spec (locked):
 *   viewBox  0 0 56 84   (aspect 2:3)
 *   path     hard-edge / no curves (instrument-grade)
 *   color    FOUND3RY uses Arc Cyan; h3ros parent uses Signal Orange
 *
 * Sized by `size` prop (px). For inline use beside text, callers should pass
 * a value approximately equal to the cap-height of the surrounding type
 * (≈ 0.72em of the font size).
 */
type Glyph3Props = {
  /** Fill color. Default: Arc Cyan token. */
  color?: string
  /** Height in pixels. Width auto-scales to maintain 56:84 aspect. */
  size?: number | string
  /** Accessibility: present as labeled image, else decorative (default). */
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
}

export default function Glyph3({
  color = 'var(--color-arc-cyan)',
  size = '0.72em',
  ariaLabel,
  className,
  style,
}: Glyph3Props) {
  const height = typeof size === 'number' ? `${size}px` : size
  // viewBox aspect: 56 / 84 = 0.666… → width = height * (56/84)
  const width = `calc(${height} * 0.6667)`
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 56 84"
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      className={className}
      style={{
        display: 'inline-block',
        height,
        width,
        flexShrink: 0,
        ...style,
      }}
    >
      <path
        d="M 0 0 L 56 0 L 56 84 L 0 84 L 0 70 L 38 70 L 38 49 L 8 49 L 8 35 L 38 35 L 38 14 L 0 14 Z"
        fill={color}
      />
    </svg>
  )
}
