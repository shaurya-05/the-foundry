/**
 * SectionHeader — DEPRECATED legacy wrapper.
 *
 * Adapts the old (title, sublabel, accent, children) API to the new
 * H3ROS <SectionHeaderV2/> primitive. The legacy `accent` prop is
 * ignored (Arc Cyan is the single accent). `children` is rendered as a
 * right-side actions slot.
 *
 * Phase 6 will rename remaining consumers and delete this file.
 */
import { ReactNode } from 'react'
import SectionHeaderV2 from './SectionHeaderV2'

interface SectionHeaderProps {
  title: string
  sublabel?: string
  /** @deprecated Arc Cyan is the only section accent. Ignored. */
  accent?: string
  /** Optional right-aligned action toolbar. */
  children?: ReactNode
}

export default function SectionHeader({ title, sublabel, children }: SectionHeaderProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 16,
      marginBottom: 24,
      flexWrap: 'wrap',
    }}>
      <SectionHeaderV2
        eyebrow={sublabel || 'SECTION'}
        title={title}
        size="sm"
        crease={false}
      />
      {children && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {children}
        </div>
      )}
    </div>
  )
}
