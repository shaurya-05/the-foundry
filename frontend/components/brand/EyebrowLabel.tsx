/**
 * EyebrowLabel — equity layer 5 (Omega dial subdivision).
 *
 * Renders `NN — KEYWORD` in IBM Plex Mono Medium, uppercase, wide-tracked.
 * Sits above every major section header.
 */
type EyebrowProps = {
  /** Section number, typically zero-padded ("01", "02"). */
  number?: string
  /** Keyword (uppercased automatically). */
  keyword: string
  /** Color override. Default n600 (secondary text). */
  color?: string
  /** Optional className. */
  className?: string
  /** Optional style overrides. */
  style?: React.CSSProperties
}

export default function EyebrowLabel({
  number,
  keyword,
  color = 'var(--color-n600)',
  className,
  style,
}: EyebrowProps) {
  return (
    <p
      className={className}
      style={{
        fontFamily: 'var(--font-plex-mono), monospace',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.4,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color,
        margin: 0,
        ...style,
      }}
    >
      {number ? `${number} — ${keyword}` : keyword}
    </p>
  )
}
