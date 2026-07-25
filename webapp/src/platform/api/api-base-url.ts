/**
 * Derives the backend API base URL from the webapp's hostname.
 *
 * When the webapp is served on localhost, the API is always at localhost:3000.
 * When served on a LAN IP (e.g. 192.168.1.131:5173), the API is at the same
 * host but port 3000. This keeps cookies scoped to the same host.
 *
 * Can be overridden with VITE_API_URL for non-standard setups.
 */
export function getApiBaseUrl(): string {
  const override = import.meta.env?.VITE_API_URL
  if (override) return override.replace(/\/$/, '')

  const hostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname
  const port = 3000
  return `http://${hostname}:${port}`
}

export function getOAuthApiBaseUrl(): string {
  const override = import.meta.env?.VITE_OAUTH_API_URL
  return override ? override.replace(/\/$/, '') : getApiBaseUrl()
}
