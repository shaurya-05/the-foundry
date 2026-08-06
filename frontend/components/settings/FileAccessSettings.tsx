'use client'

/**
 * Settings control for H3RO folder/file access grants.
 * Grants live in the browser (IndexedDB) — same store the dashboard uses.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  isFileAccessSupported,
  isFilePickerSupported,
  grantFullAccess,
  disconnectFolder,
  getConnectedFolder,
  selectFiles,
  getSelectedFiles,
  clearSelectedFiles,
  removeSelectedFile,
} from '@/lib/fileAccess'

export default function FileAccessSettings() {
  const [ready, setReady] = useState(false)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const folder = await getConnectedFolder()
      setFolderName(folder?.name || null)
      const selected = await getSelectedFiles()
      setFiles(selected.map(f => f.name))
    } catch {
      setFolderName(null)
      setFiles([])
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function onFullAccess() {
    setBusy(true)
    setError('')
    try {
      const handle = await grantFullAccess()
      setFolderName(handle.name)
      sessionStorage.removeItem('h3ro_files_skipped')
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError('Could not open folder picker. Use Chrome or Edge on desktop.')
    } finally {
      setBusy(false)
    }
  }

  async function onSelectFiles() {
    setBusy(true)
    setError('')
    try {
      if (isFilePickerSupported()) {
        const selected = await selectFiles()
        setFiles(selected.map(f => f.name))
      } else {
        setError('File picker not supported in this browser.')
      }
      sessionStorage.removeItem('h3ro_files_skipped')
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError('Could not select files.')
    } finally {
      setBusy(false)
    }
  }

  async function onRevokeFolder() {
    setBusy(true)
    await disconnectFolder()
    setFolderName(null)
    setBusy(false)
  }

  async function onClearFiles() {
    setBusy(true)
    await clearSelectedFiles()
    setFiles([])
    setBusy(false)
  }

  async function onRemoveFile(name: string) {
    await removeSelectedFile(name)
    setFiles(prev => prev.filter(n => n !== name))
  }

  if (!ready) return null

  const supported = isFileAccessSupported() || isFilePickerSupported()

  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{
        margin: '0 0 14px',
        fontSize: 13,
        lineHeight: 1.45,
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-archivo), system-ui, sans-serif',
      }}>
        Control what H3RO can read on this computer. Changes apply immediately on the dashboard.
        Access stays in this browser — not uploaded to Found3ry servers.
      </p>

      {!supported && (
        <div style={{
          padding: '10px 12px', marginBottom: 14, borderRadius: 8,
          border: '1px solid var(--border)', fontSize: 12, color: 'var(--color-n600)',
          fontFamily: 'var(--font-ibm-plex-mono)',
        }}>
          This browser doesn&apos;t support folder/file grants. Use Chrome or Edge, or attach files in the H3RO type box.
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-ink)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
          {error}
        </div>
      )}

      <Field label="Full access (folder)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {folderName ? (
            <>
              <span style={{
                fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12, color: 'var(--color-arc-cyan)',
              }}>
                ● {folderName}
              </span>
              <button type="button" onClick={onRevokeFolder} disabled={busy} style={btnSecondary}>
                Revoke folder
              </button>
              <button type="button" onClick={onFullAccess} disabled={busy || !isFileAccessSupported()} style={btnSecondary}>
                Change folder
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onFullAccess}
              disabled={busy || !isFileAccessSupported()}
              style={btnPrimary}
            >
              Grant full access…
            </button>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-n400)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
          Pick Desktop, Documents, or your user folder for the widest reach.
        </div>
      </Field>

      <Field label="Selected files">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: files.length ? 10 : 0 }}>
          <button
            type="button"
            onClick={onSelectFiles}
            disabled={busy || !isFilePickerSupported()}
            style={btnPrimary}
          >
            Select files…
          </button>
          {files.length > 0 && (
            <button type="button" onClick={onClearFiles} disabled={busy} style={btnSecondary}>
              Clear all
            </button>
          )}
        </div>
        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {files.map(name => (
              <span key={name} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)',
                fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11,
              }}>
                {name}
                <button
                  type="button"
                  onClick={() => onRemoveFile(name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-n400)', padding: 0, lineHeight: 1 }}
                  aria-label={`Remove ${name}`}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </Field>

      <Field label="Session">
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem('h3ro_files_skipped', '1')
            setError('')
          }}
          style={btnSecondary}
        >
          Continue without files (this session)
        </button>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-n400)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
          Hides the access prompt on H3RO until you grant again. You can still attach in the type box.
        </div>
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
        color: 'var(--text-muted)', marginBottom: 8,
        fontFamily: 'var(--font-barlow-condensed), sans-serif',
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 14px',
  background: 'var(--color-arc-cyan)',
  color: 'var(--color-ink)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'var(--font-archivo), system-ui, sans-serif',
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: '0.04em',
}

const btnSecondary: React.CSSProperties = {
  padding: '7px 12px',
  background: 'transparent',
  color: 'var(--color-ink)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'var(--font-ibm-plex-mono), monospace',
  fontSize: 11,
}
