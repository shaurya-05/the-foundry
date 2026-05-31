/** Returns the stored access token, or null if not present or running server-side. */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('foundry_token')
}
