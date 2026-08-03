export function getApiBaseUrl() {
  return resolveApiBaseUrl(import.meta.env.VITE_API_URL)
}

export function resolveApiBaseUrl(configured: string | undefined) {
  const value = configured?.trim()
  return value ? value.replace(/\/$/, '') : ''
}
