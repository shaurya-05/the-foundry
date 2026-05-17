/**
 * Footer — marketing-page footer with full equity-layer composition.
 *
 * Stack: Ink background + DotGrid (dark tone) + Chamfer top-left +
 * Found3ryWordmark + Crease + tagline + link columns + bottom legal line
 * with parent h3ros confirmation.
 *
 * Used on landing, /about, /pricing. NOT used on authenticated pages.
 */
import Link from 'next/link'
import Found3ryWordmark from '../brand/Found3ryWordmark'
import H3rosWordmark from '../brand/H3rosWordmark'
import DotGrid from '../brand/DotGrid'
import Chamfer from '../brand/Chamfer'
import Crease from '../brand/Crease'
import EyebrowLabel from '../brand/EyebrowLabel'

type FooterLink = { label: string; href: string; external?: boolean }
type FooterColumn = { heading: string; links: FooterLink[] }

type FooterProps = {
  columns?: FooterColumn[]
  tagline?: string
}

const DEFAULT_COLUMNS: FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Pricing', href: '/pricing' },
      { label: 'About', href: '/about' },
      { label: 'Sign in', href: '/login' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Start building', href: '/login' },
    ],
  },
  {
    heading: 'Parent',
    links: [
      { label: 'h3ros.com', href: 'https://h3ros.com', external: true },
    ],
  },
]

export default function Footer({
  columns = DEFAULT_COLUMNS,
  tagline = 'Workspace graph for multi-venture operators. An h3ros venture.',
}: FooterProps) {
  return (
    <footer style={{ position: 'relative' }}>
      <DotGrid tone="dark" style={{ position: 'relative', padding: '64px 24px 32px' }}>
        <Chamfer corner="tl" color="var(--color-arc-cyan)" />
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          {/* Brand row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 48,
            marginBottom: 64,
          }}>
            <div>
              <Found3ryWordmark inverted size="lg" />
              <div style={{ margin: '24px 0' }}>
                <Crease />
              </div>
              <p style={{
                fontFamily: 'var(--font-plex-serif), serif',
                fontStyle: 'italic',
                fontWeight: 500,
                fontSize: 17,
                lineHeight: 1.5,
                color: 'rgba(242,242,238,0.8)',
                maxWidth: '40ch',
                margin: 0,
              }}>
                {tagline}
              </p>
            </div>

            {/* Link columns */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
              gap: 32,
            }}>
              {columns.map((col) => (
                <div key={col.heading}>
                  <EyebrowLabel
                    keyword={col.heading}
                    color="rgba(242,242,238,0.5)"
                    style={{ marginBottom: 16 }}
                  />
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {col.links.map((link) => (
                      <li key={link.label}>
                        {link.external ? (
                          <a
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                              fontSize: 15,
                              color: 'var(--color-off-white)',
                              textDecoration: 'none',
                              transition: 'color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-arc-cyan)')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-off-white)')}
                          >
                            {link.label}
                          </a>
                        ) : (
                          <Link
                            href={link.href}
                            style={{
                              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                              fontSize: 15,
                              color: 'var(--color-off-white)',
                              textDecoration: 'none',
                              transition: 'color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-arc-cyan)')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-off-white)')}
                          >
                            {link.label}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom legal row */}
          <div style={{
            paddingTop: 24,
            borderTop: '1px solid rgba(242,242,238,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}>
            <EyebrowLabel
              keyword={`FOUND3RY · A VERTICAL OF h3ros · ${new Date().getFullYear()}`}
              color="rgba(242,242,238,0.4)"
            />
            <a
              href="https://h3ros.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
                textDecoration: 'none',
                opacity: 0.75,
                transition: 'opacity var(--duration-fast, 120ms) var(--ease-out, ease-out)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.75')}
            >
              <EyebrowLabel keyword="VISIT PARENT" color="rgba(242,242,238,0.7)" />
              <H3rosWordmark inverted size="sm" />
            </a>
          </div>
        </div>
      </DotGrid>
    </footer>
  )
}
