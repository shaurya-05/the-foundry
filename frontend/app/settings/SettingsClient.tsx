'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'

const AVATAR_COLORS = [
  '#E8231F', '#0A85FF', '#16A34A', '#F06A00',
  '#7C3AED', '#0891B2', '#374151', '#B45309',
]

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', desc: 'Only visible to you' },
  { value: 'team',    label: 'Team',    desc: 'Visible to workspace members' },
  { value: 'public',  label: 'Public',  desc: 'Visible to anyone with the link' },
]

export default function SettingsClient() {
  const router = useRouter()
  const { user, loading, logout, updateProfile, refreshUser } = useAuth()
  const { theme, setTheme } = useTheme()

  const [displayName, setDisplayName]       = useState('')
  const [avatarColor, setAvatarColor]       = useState('#E8231F')
  const [workspaceName, setWorkspaceName]   = useState('')
  const [defaultVis, setDefaultVis]         = useState('private')
  const [inviteEmail, setInviteEmail]       = useState('')
  const [inviteLink, setInviteLink]         = useState('')
  const [saving, setSaving]                 = useState(false)
  const [inviting, setInviting]             = useState(false)
  const [saveOk, setSaveOk]                 = useState(false)
  const [inviteErr, setInviteErr]           = useState('')
  const [inviteRole, setInviteRole]         = useState('member')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm]   = useState(false)
  const [deleting, setDeleting]             = useState(false)
  const [deleteErr, setDeleteErr]           = useState('')

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name)
      setAvatarColor(user.avatar_color)
      setWorkspaceName(user.workspace_name)
    }
  }, [user])

  if (loading || !user) return null

  async function handleSave() {
    setSaving(true)
    setSaveOk(false)
    try {
      await updateProfile({ display_name: displayName, avatar_color: avatarColor, workspace_name: workspaceName })
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2500)
    } catch {
      // show nothing extra — error is rare
    } finally {
      setSaving(false)
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteErr('')
    setInviteLink('')
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const token = localStorage.getItem('foundry_token')
      const res = await fetch(`${API_BASE}/api/workspace/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Invite failed')
      }
      const data = await res.json()
      setInviteLink(`${window.location.origin}${data.invite_url}`)
      setInviteEmail('')
    } catch (err) {
      setInviteErr(err instanceof Error ? err.message : 'Failed to create invite')
    } finally {
      setInviting(false)
    }
  }

  async function handleRoleChange(targetUserId: string, newRole: string) {
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const token = localStorage.getItem('foundry_token')
      const res = await fetch(`${API_BASE}/api/workspace/members/${targetUserId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ role: newRole }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || 'Failed to update role')
        return
      }
      refreshUser()
    } catch { /* ignore */ }
  }

  async function handleRemoveMember(targetUserId: string) {
    if (!confirm('Remove this member from the workspace?')) return
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const token = localStorage.getItem('foundry_token')
      await fetch(`${API_BASE}/api/workspace/members/${targetUserId}`, {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      refreshUser()
    } catch { /* ignore */ }
  }

  async function handleDeleteAccount() {
    if (!deletePassword) return
    setDeleting(true)
    setDeleteErr('')
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const token = localStorage.getItem('foundry_token')
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ password: deletePassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Delete failed')
      }
      logout()
      router.push('/login')
    } catch (err) {
      setDeleteErr(err instanceof Error ? err.message : 'Failed to delete account')
    } finally {
      setDeleting(false)
    }
  }

  function handleLogout() {
    logout()
    router.push('/login')
  }

  const initials = (user.display_name || user.email)
    .split(/[\s@]/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('')

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: 'var(--font-barlow-condensed)',
          fontWeight: 700, fontSize: 24,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--text-primary)', margin: 0,
        }}>
          Settings
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
          Manage your profile, workspace, and privacy
        </p>
      </div>

      {/* ─── Profile ─────────────────────────────────────────────────── */}
      <Section title="Profile" accent="#E8231F">
        {/* Avatar preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12,
            background: avatarColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-barlow-condensed)',
            fontWeight: 700, fontSize: 18, color: '#fff',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}>
            {initials}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)' }}>
              {user.display_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
              {user.email}
            </div>
            <div style={{
              display: 'inline-block', marginTop: 4,
              padding: '2px 8px', borderRadius: 4,
              background: 'rgba(232,35,31,0.08)',
              color: '#E8231F', fontSize: 10,
              fontFamily: 'var(--font-barlow-condensed)', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              {user.role}
            </div>
          </div>
        </div>

        <Field label="Display Name">
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Your name"
            style={inputStyle}
          />
        </Field>

        <Field label="Email">
          <input
            type="email"
            value={user.email}
            disabled
            style={{ ...inputStyle, background: '#F1F3F5', color: 'var(--text-muted)', cursor: 'not-allowed' }}
          />
        </Field>

        <Field label="Avatar Color">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {AVATAR_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setAvatarColor(c)}
                style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: c, border: 'none', cursor: 'pointer',
                  outline: avatarColor === c ? `3px solid ${c}` : 'none',
                  outlineOffset: 2,
                  transition: 'outline 0.1s',
                }}
              />
            ))}
          </div>
        </Field>
      </Section>

      {/* ─── Appearance ──────────────────────────────────────────────── */}
      <Section title="Appearance" accent="#F06A00">
        <Field label="Theme">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['light', 'dark', 'system'] as const).map(t => (
              <button
                key={t}
                onClick={() => {
                  setTheme(t)
                  updateProfile({ preferences: { ...(user?.preferences || {}), theme: t } })
                }}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${theme === t ? '#F06A00' : 'var(--border)'}`,
                  background: theme === t ? 'rgba(240,106,0,0.06)' : 'var(--bg-surface)',
                  color: theme === t ? '#F06A00' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
                  fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                  transition: 'border-color 0.15s',
                }}
              >
                {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System'}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      {/* ─── Workspace ──────────────────────────────────────────────── */}
      <Section title="Workspace" accent="#0A85FF">
        <Field label="Workspace Name">
          <input
            type="text"
            value={workspaceName}
            onChange={e => setWorkspaceName(e.target.value)}
            placeholder="Your workspace name"
            style={inputStyle}
          />
        </Field>

        {/* Members list */}
        <Field label={`Members (${user.members_count})`}>
          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {user.members.map((m, i) => (
              <div key={m.user_id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px',
                borderBottom: i < user.members.length - 1 ? '1px solid var(--border)' : 'none',
                background: '#FFFFFF',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: m.avatar_color || '#E8231F',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#fff',
                  fontFamily: 'var(--font-barlow-condensed)',
                  flexShrink: 0,
                }}>
                  {(m.display_name || m.email).split(/[\s@]/)[0]?.[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)' }}>
                    {m.display_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.email}
                  </div>
                </div>
                {(user.role === 'owner' || user.role === 'admin') && m.user_id !== user.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <select
                      value={m.role}
                      onChange={e => handleRoleChange(m.user_id, e.target.value)}
                      style={{
                        padding: '2px 4px', borderRadius: 4, fontSize: 10,
                        border: '1px solid var(--border)', background: '#FAFAFA',
                        fontFamily: 'var(--font-barlow-condensed)', letterSpacing: '0.07em',
                        textTransform: 'uppercase', color: 'var(--text-muted)', cursor: 'pointer',
                      }}
                    >
                      {user.role === 'owner' && <option value="owner">Owner</option>}
                      {user.role === 'owner' && <option value="admin">Admin</option>}
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      onClick={() => handleRemoveMember(m.user_id)}
                      title="Remove member"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#9CA3AF', fontSize: 14, lineHeight: 1, padding: '2px 4px',
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <span style={{
                    padding: '2px 7px', borderRadius: 4,
                    background: m.role === 'owner' ? 'rgba(232,35,31,0.08)' : 'rgba(0,0,0,0.05)',
                    color: m.role === 'owner' ? '#E8231F' : 'var(--text-muted)',
                    fontSize: 10,
                    fontFamily: 'var(--font-barlow-condensed)', letterSpacing: '0.07em', textTransform: 'uppercase',
                  }}>
                    {m.role}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Field>

        {/* Invite */}
        <Field label="Invite Member">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
              style={{ ...inputStyle, flex: 1 }}
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value)}
              style={{
                padding: '8px 6px', borderRadius: 7, fontSize: 12,
                border: '1px solid rgba(0,0,0,0.10)', background: '#F9FAFB',
                fontFamily: 'var(--font-barlow-condensed)', textTransform: 'uppercase',
                letterSpacing: '0.06em', color: '#374151',
              }}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail}
              style={smallBtnStyle}
            >
              {inviting ? '…' : 'Invite'}
            </button>
          </div>
          {inviteLink && (
            <div style={{
              marginTop: 8, padding: '8px 12px',
              background: 'rgba(22,163,74,0.06)',
              border: '1px solid rgba(22,163,74,0.2)',
              borderRadius: 7, fontSize: 11,
              fontFamily: 'var(--font-ibm-plex-mono)', color: '#16A34A',
            }}>
              Invite link (share this):<br />
              <span style={{ wordBreak: 'break-all', userSelect: 'all' }}>{inviteLink}</span>
            </div>
          )}
          {inviteErr && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#E8231F', fontFamily: 'var(--font-ibm-plex-mono)' }}>
              {inviteErr}
            </div>
          )}
        </Field>
      </Section>

      {/* ─── Subscription ─────────────────────────────────────────── */}
      <SubscriptionSection />

      {/* ─── Privacy ────────────────────────────────────────────────── */}
      <Section title="Privacy" accent="#7C3AED">
        <Field label="Default Project Visibility">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {VISIBILITY_OPTIONS.map(opt => (
              <label
                key={opt.value}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${defaultVis === opt.value ? '#7C3AED' : 'var(--border)'}`,
                  background: defaultVis === opt.value ? 'rgba(124,58,237,0.05)' : '#FAFAFA',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={opt.value}
                  checked={defaultVis === opt.value}
                  onChange={() => setDefaultVis(opt.value)}
                  style={{ accentColor: '#7C3AED' }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)' }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
                    {opt.desc}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </Field>
      </Section>

      {/* ─── Notifications ────────────────────────────────────────────── */}
      <Section title="Notifications" accent="#0891B2">
        <Field label="Email Notifications">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { key: 'email_invites', label: 'Workspace invitations' },
              { key: 'email_tasks', label: 'Task assignments' },
              { key: 'email_updates', label: 'Project updates' },
            ].map(opt => (
              <label key={opt.key} style={{
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-barlow)',
              }}>
                <input
                  type="checkbox"
                  defaultChecked={true}
                  style={{ accentColor: '#0891B2' }}
                  onChange={e => {
                    updateProfile({
                      preferences: {
                        ...(user?.preferences || {}),
                        notifications: {
                          ...((user?.preferences?.notifications as Record<string, boolean>) || {}),
                          [opt.key]: e.target.checked,
                        },
                      },
                    })
                  }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </Field>
      </Section>

      {/* ─── Data & Export ──────────────────────────────────────────── */}
      <Section title="Data & Export" accent="#374151">
        <Field label="Export Your Data">
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)', marginBottom: 10 }}>
            Download a copy of all your projects, tasks, knowledge items, and ideas as JSON.
          </p>
          <button
            onClick={async () => {
              const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
              const token = localStorage.getItem('foundry_token')
              const res = await fetch(`${API_BASE}/api/auth/export`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (res.ok) {
                const data = await res.json()
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = 'foundry-export.json'; a.click()
                URL.revokeObjectURL(url)
              }
            }}
            style={{
              padding: '8px 18px', background: 'none',
              border: '1px solid var(--border)', borderRadius: 7,
              color: 'var(--text-secondary)', cursor: 'pointer',
              fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
              fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >
            Export Data
          </button>
        </Field>
      </Section>

      {/* ─── Danger Zone ─────────────────────────────────────────────── */}
      <Section title="Danger Zone" accent="#DC2626">
        {!deleteConfirm ? (
          <div style={{ padding: '0 20px 16px' }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)', marginBottom: 12 }}>
              Permanently delete your account and all associated data.
            </p>
            <button
              onClick={() => setDeleteConfirm(true)}
              style={{
                padding: '8px 18px', background: 'none',
                border: '1px solid #DC2626', borderRadius: 7,
                color: '#DC2626', cursor: 'pointer',
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
                fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}
            >
              Delete Account
            </button>
          </div>
        ) : (
          <div style={{ padding: '0 20px 16px' }}>
            <p style={{ fontSize: 13, color: '#DC2626', fontFamily: 'var(--font-ibm-plex-mono)', marginBottom: 12, fontWeight: 600 }}>
              Enter your password to confirm account deletion. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="password"
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                placeholder="Your password"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={handleDeleteAccount}
                disabled={deleting || !deletePassword}
                style={{
                  padding: '8px 18px',
                  background: deleting ? '#E5E7EB' : '#DC2626',
                  color: '#FFF', border: 'none', borderRadius: 7, cursor: deleting ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
                  fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}
              >
                {deleting ? '…' : 'Confirm Delete'}
              </button>
              <button
                onClick={() => { setDeleteConfirm(false); setDeletePassword(''); setDeleteErr('') }}
                style={{
                  padding: '8px 14px', background: 'none',
                  border: '1px solid var(--border)', borderRadius: 7,
                  color: '#6B7280', cursor: 'pointer',
                  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 12,
                }}
              >
                Cancel
              </button>
            </div>
            {deleteErr && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#DC2626', fontFamily: 'var(--font-ibm-plex-mono)' }}>
                {deleteErr}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ─── Save + Sign Out ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 40 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px',
            background: saving ? '#E5E7EB' : 'linear-gradient(135deg, #E8231F 0%, #C81E1C 100%)',
            color: saving ? '#9CA3AF' : '#fff',
            border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-barlow-condensed)',
            fontWeight: 600, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
          }}
        >
          {saving ? 'Saving…' : saveOk ? '✓ Saved' : 'Save Changes'}
        </button>

        <button
          onClick={handleLogout}
          style={{
            padding: '10px 20px',
            background: 'none',
            color: '#6B7280',
            border: '1px solid var(--border)',
            borderRadius: 8, cursor: 'pointer',
            fontFamily: 'var(--font-barlow-condensed)',
            fontWeight: 600, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
          }}
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}

// ─── Subscription Section ────────────────────────────────────────────────────

function SubscriptionSection() {
  const [sub, setSub] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('foundry_token')
    const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    fetch(`${API}/api/subscription`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setSub(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function handleUpgrade(planId: string, cycle: string) {
    setUpgrading(planId)
    try {
      const token = localStorage.getItem('foundry_token')
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const res = await fetch(`${API}/api/subscription/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_id: planId, billing_cycle: cycle }),
      })
      const data = await res.json()
      if (data.checkout_url) {
        window.location.href = data.checkout_url
      } else {
        alert(data.detail || 'Could not create checkout')
      }
    } catch { alert('Checkout unavailable') }
    setUpgrading('')
  }

  async function handleManageBilling() {
    try {
      const token = localStorage.getItem('foundry_token')
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const res = await fetch(`${API}/api/subscription/portal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.portal_url) window.location.href = data.portal_url
      else alert(data.detail || 'Billing portal unavailable')
    } catch { alert('Portal unavailable') }
  }

  if (loading) return <Section title="Plan & Usage" accent="#F59E0B"><div style={{ padding: '0 20px 16px', color: 'var(--text-muted)' }}>Loading...</div></Section>
  if (!sub) return null

  const plan = sub.plan || {}
  const usage = sub.usage || {}
  const limits = plan.limits || {}
  const planName = plan.name || 'Early Access'
  const isEarlyAccess = plan.id === 'early_access'
  const isPaid = plan.id !== 'spark' || isEarlyAccess

  const usageItems = [
    { label: 'COFOUND3R Messages', used: usage.copilot_messages || 0, limit: limits.copilot_messages || 0 },
    { label: 'Agent Runs', used: usage.agent_runs || 0, limit: limits.agent_runs || 0 },
    { label: 'Forge Operations', used: usage.forge_operations || 0, limit: limits.forge_operations || 0 },
    { label: 'Pipeline Runs', used: usage.pipeline_runs || 0, limit: limits.pipeline_runs || 0 },
  ]

  return (
    <Section title="Plan & Usage" accent="#F59E0B">
      {/* Current plan badge */}
      <div style={{ padding: '0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            padding: '4px 12px', borderRadius: 6,
            background: isPaid ? 'rgba(14,165,233,0.1)' : 'rgba(0,0,0,0.05)',
            color: isPaid ? '#0EA5E9' : 'var(--text-muted)',
            fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-barlow-condensed)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            {planName}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
            {isPaid ? `$${(plan.price_monthly / 100).toFixed(0)}/mo` : 'Free'}
          </span>
        </div>
        {isEarlyAccess ? (
          <span style={{
            padding: '6px 14px', borderRadius: 6,
            background: 'rgba(45,204,114,0.1)', color: '#16A34A',
            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-barlow-condensed)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            All Features Unlocked
          </span>
        ) : isPaid ? (
          <button onClick={handleManageBilling} style={{
            padding: '6px 14px', background: 'none', border: '1px solid var(--border)',
            borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            fontFamily: 'var(--font-barlow-condensed)', letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--text-secondary)',
          }}>
            Manage Billing
          </button>
        ) : (
          <button onClick={() => handleUpgrade('pro', 'monthly')} disabled={!!upgrading} style={{
            padding: '6px 14px',
            background: upgrading ? '#E5E7EB' : 'linear-gradient(135deg, #0EA5E9, #0284C7)',
            color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
            fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-barlow-condensed)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {upgrading ? '...' : 'Upgrade to Pro'}
          </button>
        )}
      </div>

      {/* Usage bars */}
      <Field label="This Month's Usage">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {usageItems.map(item => {
            const pct = item.limit === -1 ? 0 : item.limit > 0 ? Math.min((item.used / item.limit) * 100, 100) : 0
            const isUnlimited = item.limit === -1
            const isNearLimit = pct >= 80
            const isAtLimit = pct >= 100
            return (
              <div key={item.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-barlow)' }}>
                    {item.label}
                  </span>
                  <span style={{
                    fontSize: 11, fontFamily: 'var(--font-ibm-plex-mono)',
                    color: isAtLimit ? '#DC2626' : isNearLimit ? '#F59E0B' : 'var(--text-muted)',
                  }}>
                    {item.used}{isUnlimited ? ' / ∞' : ` / ${item.limit}`}
                  </span>
                </div>
                <div style={{
                  height: 6, borderRadius: 3, background: 'var(--border, rgba(0,0,0,0.08))',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: isUnlimited ? '0%' : `${pct}%`,
                    background: isAtLimit ? '#DC2626' : isNearLimit ? '#F59E0B' : '#0EA5E9',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      </Field>

      {/* Upgrade CTA for free users */}
      {!isPaid && (
        <div style={{
          padding: '12px 16px', borderRadius: 8,
          background: 'linear-gradient(135deg, rgba(14,165,233,0.05), rgba(124,58,237,0.05))',
          border: '1px solid rgba(14,165,233,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)' }}>
              Unlock unlimited projects & 500 COFOUND3R messages
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)', marginTop: 2 }}>
              Pro plan — $16/mo or $12/mo billed annually
            </div>
          </div>
          <button onClick={() => window.location.href = '/pricing'} style={{
            padding: '8px 16px', background: 'linear-gradient(135deg, #0EA5E9, #0284C7)',
            color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer',
            fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-barlow-condensed)',
            letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            See Plans
          </button>
        </div>
      )}
    </Section>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid var(--border)',
      borderRadius: 12,
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ width: 3, height: 14, borderRadius: 2, background: accent }} />
        <span style={{
          fontFamily: 'var(--font-barlow-condensed)',
          fontWeight: 700, fontSize: 12, letterSpacing: '0.10em',
          textTransform: 'uppercase', color: 'var(--text-primary)',
        }}>
          {title}
        </span>
      </div>
      <div style={{ padding: '20px 20px 4px' }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
        color: '#374151', fontFamily: 'var(--font-barlow-condensed)', marginBottom: 7,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  background: '#F9FAFB',
  border: '1px solid rgba(0,0,0,0.10)',
  borderRadius: 7,
  fontSize: 13,
  color: '#0A0C12',
  fontFamily: 'var(--font-barlow)',
  outline: 'none',
  boxSizing: 'border-box',
}

const smallBtnStyle: React.CSSProperties = {
  padding: '9px 16px',
  background: '#0A0C12',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 7,
  cursor: 'pointer',
  fontFamily: 'var(--font-barlow-condensed)',
  fontWeight: 600, fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase',
  flexShrink: 0,
  whiteSpace: 'nowrap',
}
