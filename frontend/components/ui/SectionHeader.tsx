import { ReactNode } from 'react'

interface SectionHeaderProps {
  title: string
  sublabel?: string
  accent?: string
  children?: ReactNode
}

export default function SectionHeader({ title, sublabel, accent = '#FF2D2D', children }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 24,
        paddingBottom: 18,
        borderBottom: '1px solid var(--border)',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        {/* Accent bar */}
        <div style={{
          width: 3,
          height: 38,
          borderRadius: 2,
          background: `linear-gradient(180deg, ${accent} 0%, ${accent}44 100%)`,
          flexShrink: 0,
          boxShadow: `0 0 14px ${accent}60`,
          marginBottom: 2,
        }} />
        <div>
          {sublabel && (
            <div
              style={{
                fontFamily: 'var(--font-ibm-plex-mono)',
                fontSize: 9,
                color: `${accent}CC`,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              {sublabel}
            </div>
          )}
          <h2
            style={{
              fontFamily: 'var(--font-barlow-condensed)',
              fontWeight: 700,
              fontSize: 30,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--text-primary)',
              lineHeight: 1,
            }}
          >
            {title}
          </h2>
        </div>
      </div>
      {children && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
          {children}
        </div>
      )}
    </div>
  )
}
