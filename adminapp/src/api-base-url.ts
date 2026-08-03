export function getApiBaseUrl() {
  const configured = import.meta.env.VITE_API_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')

  const hostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname
  return `http://${hostname}:3000`
}
