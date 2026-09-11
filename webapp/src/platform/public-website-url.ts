export function getPublicWebsiteUrl(): string {
  const override = import.meta.env?.VITE_PUBLIC_WEBSITE_URL
  if (override) {
    const url = new URL(override)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('VITE_PUBLIC_WEBSITE_URL must be an HTTP(S) URL without credentials')
    }
    return url.origin
  }
  if (import.meta.env?.DEV) {
    const url = new URL(window.location.origin)
    url.port = '4321'
    return url.origin
  }
  return 'https://anomaly-detector.ru'
}
