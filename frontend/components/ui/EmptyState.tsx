import { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  subtitle?: string
  action?: {
    label: string
    onClick: () => void
  }
  accent?: string
}

export default function EmptyState({ icon, title, subtitle, action, accent = '#637080' }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '48px 24px',
        textAlign: 'center',
      }}
    >
      <div
        className="ring-out-container"
        style={{ color: accent, width: 48, height: 48 }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: `${accent}15`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
      </div>
      <div>
        <h3
          style={{
            fontFamily: 'var(--font-barlow-condensed)',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <p
            style={{
              fontFamily: 'var(--font-barlow)',
              fontSize: 13,
              color: 'var(--text-muted)',
              maxWidth: 280,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 4 }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
