/**
 * Desktop-only bridge for Phase 7a cloud account linking.
 * Absent in plain browser / found3ry.com web deployments.
 */

export type CloudLinkEncryptionStatus = {
  available: boolean
  hasStoredLink: boolean
  encPath: string
  usingEncryptedFile: boolean
  usingPlaintextFile: boolean
}

export type CloudLinkLocalStatus = {
  hasStoredLink: boolean
  encryption: CloudLinkEncryptionStatus
  cloud_workspace_id: string | null
  cloud_user_id: string | null
  cloud_email: string | null
  cloud_api_url: string | null
  linked_at: string | null
}

export type CloudLinkResult = {
  ok: boolean
  error?: string
  encrypted?: boolean
  cloud_workspace_id?: string
  cloud_user_id?: string
  cloud_email?: string
  cloud_api_url?: string
  linked_at?: string
  tokensCleared?: boolean
  status?: CloudSyncApiStatus
}

export type CloudSyncApiStatus = {
  enabled: boolean
  linked: boolean
  cloud_workspace_id: string | null
  cloud_user_id: string | null
  cloud_email: string | null
  linked_at: string | null
  last_synced_at: string | null
}

type FoundryCloudLinkApi = {
  encryptionStatus: () => Promise<CloudLinkEncryptionStatus>
  status: () => Promise<CloudLinkLocalStatus>
  link: (opts: {
    email: string
    password: string
    mode?: 'login' | 'register'
    displayName?: string
    localAccessToken: string
  }) => Promise<CloudLinkResult>
  unlink: (opts: { localAccessToken: string }) => Promise<CloudLinkResult>
}

declare global {
  interface Window {
    foundryCloudLink?: FoundryCloudLinkApi
  }
}

export function isCloudLinkAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.foundryCloudLink?.link
}
