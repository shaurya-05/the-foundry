/**
 * SectionHeaderV2 — H3ROS section header.
 *
 * Stack: EyebrowLabel → Archivo Black display heading → IBM Plex Serif italic
 * lead paragraph (optional) → Crease beneath.
 *
 * Phase 6 renames this back to SectionHeader after the legacy file is deleted.
 */
import EyebrowLabel from '../brand/EyebrowLabel'
import Crease from '../brand/Crease'

type Size = 'sm' | 'md' | 'lg'

const TITLE_SIZE: Record<Size, number> = {
  sm: 32,
  md: 40,
  lg: 56,
}

type SectionHeaderProps = {
  /** Section number, zero-padded (e.g., "01"). Optional. */
  number?: string
  /** Eyebrow keyword (uppercased automatically). */
  eyebrow: string
  /** Display title (sentence case + period per voice rules). */
  title: string
  /** Optional lead paragraph in editorial italic. */
  lead?: string
  /** Display size preset. Default md. */
  size?: Size
  /** Show the Arc Cyan crease beneath the title. Default true. */
  crease?: boolean
  /** Inverted (dark surface) coloring. */
  inverted?: boolean
  /** Optional className for the wrapping <header>. */
  className?: string
  /** Optional inline style. */
  style?: React.CSSProperties
}

export default function SectionHeaderV2({
  number,
  eyebrow,
  title,
  lead,
  size = 'md',
  crease = true,
  inverted = false,
  className,
  style,
}: SectionHeaderProps) {
  const titleColor = inverted ? 'var(--color-off-white)' : 'var(--color-ink)'
  const leadColor = inverted ? 'rgba(242,242,238,0.75)' : 'var(--color-n600)'
  const eyebrowColor = inverted ? 'rgba(242,242,238,0.65)' : 'var(--color-n600)'

  return (
    <header className={className} style={{ maxWidth: '56ch', ...style }}>
      <EyebrowLabel
        number={number}
        keyword={eyebrow}
        color={eyebrowColor}
        style={{ marginBottom: 16 }}
      />
      <h2
        style={{
          fontFamily: 'var(--font-archivo-black), sans-serif',
          fontWeight: 400,
          fontSize: TITLE_SIZE[size],
          lineHeight: 1.05,
          letterSpacing: '-0.03em',
          color: titleColor,
          margin: 0,
          marginBottom: 16,
        }}
      >
        {title}
      </h2>
      {crease && <div style={{ margin: '0 0 16px' }}><Crease /></div>}
      {lead && (
        <p
          style={{
            fontFamily: 'var(--font-plex-serif), serif',
            fontWeight: 500,
            fontStyle: 'italic',
            fontSize: 20,
            lineHeight: 1.4,
            color: leadColor,
            margin: 0,
            maxWidth: '48ch',
          }}
        >
          {lead}
        </p>
      )}
    </header>
  )
}
