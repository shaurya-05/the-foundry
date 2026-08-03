/**
 * File System Access API wrapper — Phase 3, Stage 3.
 *
 * The backend has zero filesystem access to the user's machine. When the
 * agent needs a file, the request round-trips through here: the backend
 * emits a `tool_request` SSE event (see streaming.ts's StreamChunk), this
 * module does the real read using the FileSystemDirectoryHandle the user
 * granted, and the result gets POSTed back to /api/copilot/tool-result.
 *
 * Read-only in this phase, deliberately — no write/create/delete methods
 * exist here at all, not just "unused." That's a phase-scope decision,
 * not a technical limitation of the underlying API.
 *
 * Safari has no File System Access API support at all (as of this
 * writing) — isFileAccessSupported() is the single feature-detection
 * point everything else in the UI should gate on, so callers fall back
 * to the existing upload flow instead of silently failing.
 */

import { API_URL } from '@/lib/config'
import { getToken } from '@/lib/auth'
import type { StreamChunk } from '@/lib/streaming'

const DB_NAME = 'found3ry-file-access'
const DB_VERSION = 1
const STORE_NAME = 'handles'
const HANDLE_KEY = 'connected-root'

export function isFileAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Opens the native folder picker and persists the resulting handle
 * (FileSystemDirectoryHandle is structured-clone-serializable, so it can
 * go directly into IndexedDB — unlike localStorage, which can't hold it
 * at all). Must be called from a real user gesture (click handler) —
 * browsers reject showDirectoryPicker() calls that aren't.
 */
export async function connectFolder(): Promise<FileSystemDirectoryHandle> {
  // @ts-expect-error -- showDirectoryPicker isn't in TS's default lib.dom yet on all versions
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'read' })
  await idbSet(HANDLE_KEY, handle)
  return handle
}

export async function disconnectFolder(): Promise<void> {
  await idbDelete(HANDLE_KEY)
}

/**
 * Returns the previously-connected handle if permission is still valid,
 * re-requesting permission (which browsers allow without a fresh user
 * gesture ONLY if it was granted before and hasn't been revoked -- if the
 * browser demands a new gesture, this returns null and the caller must
 * prompt the user to click something to reconnect).
 */
export async function getConnectedFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY)
  if (!handle) return null
  try {
    const perm = await handle.queryPermission({ mode: 'read' })
    if (perm === 'granted') return handle
    const requested = await handle.requestPermission({ mode: 'read' })
    return requested === 'granted' ? handle : null
  } catch {
    // Handle may reference a folder that's been moved/deleted, or the
    // browser profile changed -- treat as disconnected, don't throw.
    return null
  }
}

export type FileEntry = {
  name: string
  kind: 'file' | 'directory'
  size?: number
  lastModified?: number
}

/**
 * Lists immediate entries only (name + type + size for files) -- never
 * reads file content. `path` is a slash-separated path relative to the
 * connected root; "" (or omitted) lists the root itself. Rejects any
 * path containing ".." defensively, even though the underlying API
 * itself is already sandboxed to the granted tree and can't actually
 * escape it.
 */
export async function listDirectory(root: FileSystemDirectoryHandle, path = ''): Promise<FileEntry[]> {
  const dir = await resolveDirectory(root, path)
  const entries: FileEntry[] = []
  // @ts-expect-error -- FileSystemDirectoryHandle.entries() async iterator
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile()
      entries.push({ name, kind: 'file', size: file.size, lastModified: file.lastModified })
    } else {
      entries.push({ name, kind: 'directory' })
    }
  }
  return entries
}

/** Reads one file's full text content. `path` is relative to the connected root. */
export async function readFileContent(root: FileSystemDirectoryHandle, path: string): Promise<string> {
  const segments = splitPath(path)
  const fileName = segments.pop()
  if (!fileName) throw new Error('empty file path')
  const dir = await resolveDirectory(root, segments.join('/'))
  const fileHandle = await dir.getFileHandle(fileName)
  const file = await fileHandle.getFile()
  return file.text()
}

function splitPath(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  if (segments.includes('..')) {
    throw new Error('path traversal ("..") is not allowed')
  }
  return segments
}

async function resolveDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const segment of splitPath(path)) {
    dir = await dir.getDirectoryHandle(segment)
  }
  return dir
}

/**
 * The frontend half of the async_frontend round-trip (see
 * backend/app/services/agent_tools.py's module docstring for the full
 * protocol). Called whenever streamSSE() yields a `tool_request` chunk
 * whose `tool` is one this module owns ("list_files" / "read_file").
 * Always POSTs SOMETHING back to /api/copilot/tool-result -- including
 * an explicit error payload on failure -- so the backend's pending
 * future resolves either way rather than only timing out silently.
 */
export async function handleFileToolRequest(chunk: Extract<StreamChunk, { type: 'tool_request' }>): Promise<void> {
  let result: Record<string, unknown>
  try {
    const root = await getConnectedFolder()
    if (!root) {
      result = { error: 'No folder is connected, or permission was not granted.' }
    } else if (chunk.tool === 'list_files') {
      const path = typeof chunk.args.path === 'string' ? chunk.args.path : ''
      result = { entries: await listDirectory(root, path) }
    } else if (chunk.tool === 'read_file') {
      const path = chunk.args.path
      if (typeof path !== 'string' || !path) {
        result = { error: 'read_file requires a non-empty "path" argument' }
      } else {
        result = { content: await readFileContent(root, path) }
      }
    } else {
      // Not a file-access tool -- nothing for this module to do. The
      // caller should only route tool_request chunks here for tools it
      // knows this module owns; this branch is a defensive fallback.
      return
    }
  } catch (e) {
    result = { error: e instanceof Error ? e.message : 'unknown file-access error' }
  }

  await fetch(`${API_URL}/api/copilot/tool-result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify({ call_id: chunk.call_id, ...result }),
  })
}
