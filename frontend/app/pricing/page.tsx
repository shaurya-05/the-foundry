'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const PLANS = [
  {
    id: 'spark',
    name: 'Spark',
    tagline: 'For solo builders getting started',
    monthlyPrice: 0,
    yearlyPrice: 0,
    accent: '#6B7280',
    features: [
      '1 workspace, 1 member',
      '3 projects',
      '50 knowledge items',
      '25 COFOUND3R messages/mo',
      '10 agent runs/mo',
      '3 forge operations/mo',
      'Community support',
    ],
    cta: 'Get Started Free',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For serious builders shipping fast',
    monthlyPrice: 16,
    yearlyPrice: 12,
    accent: '#0A85FF',
    recommended: true,
    features: [
      'Unlimited projects',
      '500 knowledge items',
      '500 COFOUND3R messages/mo',
      '100 agent runs/mo',
      '50 forge operations/mo',
      '20 pipeline runs/mo',
      'Full Blueprint canvas',
      'Priority support',
    ],
    cta: 'Upgrade to Pro',
  },
  {
    id: 'forge_team',
    name: 'Forge Team',
    tagline: 'For teams building together',
    monthlyPrice: 28,
    yearlyPrice: 22,
    perSeat: true,
    accent: '#7C3AED',
    features: [
      'Everything in Pro',
      'Unlimited workspaces & knowledge',
      '1000 messages/seat/mo',
      '200 agent runs/seat/mo',
      '100 forges/seat/mo',
      '50 pipeline runs/seat/mo',
      'Up to 25 team members',
      'Real-time collaboration',
      'Role-based access control',
      'Dedicated support',
    ],
    cta: 'Start Team Plan',
  },
]

export default function PricingPage() {
  const router = useRouter()
  const [annual, setAnnual] = useState(false)

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg, #F4F5F7)',
      padding: '60px 24px', fontFamily: 'var(--font-barlow)',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h1 style={{
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
            fontSize: 36, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--text-primary, #0A0C12)', marginBottom: 8,
          }}>
            Pricing
          </h1>
          <p style={{ color: 'var(--text-muted, #6B7280)', fontSize: 15, fontFamily: 'var(--font-ibm-plex-mono)' }}>
            From idea to launch. Pick your forge.
          </p>

          {/* Billing toggle */}
          <div style={{
            display: 'inline-flex', gap: 0, marginTop: 24,
            border: '1px solid var(--border, rgba(0,0,0,0.07))', borderRadius: 8, overflow: 'hidden',
          }}>
            {['Monthly', 'Annual'].map((label, i) => (
              <button
                key={label}
                onClick={() => setAnnual(i === 1)}
                style={{
                  padding: '8px 20px', border: 'none', cursor: 'pointer',
                  background: (i === 0 ? !annual : annual) ? '#E8231F' : 'var(--bg-surface, #fff)',
                  color: (i === 0 ? !annual : annual) ? '#fff' : 'var(--text-muted, #6B7280)',
                  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
                  fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}
              >
                {label} {i === 1 && <span style={{ fontSize: 10, opacity: 0.8 }}>Save 25%</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          {PLANS.map(plan => {
            const price = annual ? plan.yearlyPrice : plan.monthlyPrice
            return (
              <div key={plan.id} style={{
                background: 'var(--bg-surface, #fff)',
                border: plan.recommended ? `2px solid ${plan.accent}` : '1px solid var(--border, rgba(0,0,0,0.07))',
                borderRadius: 14, padding: 32, position: 'relative',
                boxShadow: plan.recommended ? `0 4px 24px ${plan.accent}20` : '0 2px 12px rgba(0,0,0,0.04)',
              }}>
                {plan.recommended && (
                  <div style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    background: plan.accent, color: '#fff', padding: '4px 14px', borderRadius: 20,
                    fontSize: 10, fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>
                    Recommended
                  </div>
                )}

                <div style={{
                  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
                  fontSize: 14, letterSpacing: '0.10em', textTransform: 'uppercase',
                  color: plan.accent, marginBottom: 4,
                }}>
                  {plan.name}
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                  <span style={{
                    fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
                    fontSize: 42, color: 'var(--text-primary, #0A0C12)',
                  }}>
                    ${price}
                  </span>
                  {price > 0 && (
                    <span style={{ fontSize: 13, color: 'var(--text-muted, #6B7280)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
                      /{plan.perSeat ? 'seat/' : ''}mo
                    </span>
                  )}
                </div>

                <p style={{
                  fontSize: 13, color: 'var(--text-muted, #6B7280)',
                  fontFamily: 'var(--font-ibm-plex-mono)', marginBottom: 24,
                }}>
                  {plan.tagline}
                </p>

                <button
                  onClick={() => router.push(plan.id === 'spark' ? '/login' : '/settings')}
                  style={{
                    width: '100%', padding: '11px 20px', borderRadius: 8, cursor: 'pointer',
                    background: plan.recommended
                      ? `linear-gradient(135deg, ${plan.accent}, ${plan.accent}dd)`
                      : 'none',
                    color: plan.recommended ? '#fff' : plan.accent,
                    border: plan.recommended ? 'none' : `1px solid ${plan.accent}`,
                    fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
                    fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase',
                    marginBottom: 24,
                  }}
                >
                  {plan.cta}
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {plan.features.map((f, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 13, color: 'var(--text-secondary, #374151)', fontFamily: 'var(--font-barlow)',
                    }}>
                      <span style={{ color: plan.accent, fontSize: 14, fontWeight: 700 }}>+</span>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Back to app link */}
        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted, #6B7280)', fontSize: 12,
              fontFamily: 'var(--font-ibm-plex-mono)', textDecoration: 'underline',
            }}
          >
            Back to dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
