'use client'

type Visibility = 'private' | 'team' | 'public'

interface VisibilityBadgeProps {
  visibility: Visibility
  clearanceLevel?: number
  onCycle?: () => void
  onCycleClearance?: () => void
  size?: 'sm' | 'md'
}

const CONFIG: Record<Visibility, { icon: string; label: string; color: string; bg: string }> = {
  private: { icon: '⊘', label: 'PRIVATE', color: '#6B7280', bg: '#6B728018' },
  team:    { icon: '⬡', label: 'TEAM',    color: '#7C3AED', bg: '#7C3AED18' },
  public:  { icon: '◉', label: 'PUBLIC',  color: '#16A34A', bg: '#16A34A18' },
}

const CLEARANCE_LABELS: Record<number, string> = {
  0: 'STEALTH',
  1: 'DRAFT',
  2: 'READY',
  3: 'SHIPPED',
}

const CLEARANCE_COLORS: Record<number, string> = {
  0: '#6B7280',
  1: '#F06A00',
  2: '#0A85FF',
  3: '#16A34A',
}

export default function VisibilityBadge({
  visibility,
  clearanceLevel,
  onCycle,
  onCycleClearance,
  size = 'sm',
}: VisibilityBadgeProps) {
  const cfg = CONFIG[visibility] ?? CONFIG.private
  const fontSize = size === 'sm' ? 8 : 10
  const padding = size === 'sm' ? '3px 7px' : '4px 10px'

  function stopAndCall(fn?: () => void) {
    return (e: React.MouseEvent) => {
      e.stopPropagation()
      fn?.()
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {/* Visibility cycle button */}
      <button
        onClick={stopAndCall(onCycle)}
        disabled={!onCycle}
        title={onCycle ? 'Click to change visibility' : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding,
          background: cfg.bg,
          border: `1px solid ${cfg.color}30`,
          borderRadius: 4,
          color: cfg.color,
          fontFamily: 'var(--font-ibm-plex-mono)',
          fontSize,
          letterSpacing: '0.07em',
          cursor: onCycle ? 'pointer' : 'default',
          transition: 'background 0.15s ease',
        }}
      >
        <span>{cfg.icon}</span>
        <span>{cfg.label}</span>
      </button>

      {/* Clearance level badge (clickable if onCycleClearance provided) */}
      {clearanceLevel !== undefined && (
        <button
          onClick={stopAndCall(onCycleClearance)}
          disabled={!onCycleClearance}
          title={onCycleClearance ? 'Click to advance clearance level' : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: `${padding.split(' ')[0]} ${padding.split(' ')[0]}`,
            background: `${CLEARANCE_COLORS[clearanceLevel]}12`,
            border: `1px solid ${CLEARANCE_COLORS[clearanceLevel]}25`,
            borderRadius: 4,
            fontFamily: 'var(--font-ibm-plex-mono)',
            fontSize: fontSize - 1,
            color: CLEARANCE_COLORS[clearanceLevel],
            letterSpacing: '0.06em',
            cursor: onCycleClearance ? 'pointer' : 'default',
            transition: 'background 0.15s ease',
          }}
        >
          {CLEARANCE_LABELS[clearanceLevel] ?? `LVL ${clearanceLevel}`}
        </button>
      )}
    </span>
  )
}
