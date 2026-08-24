import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const productionWebsiteOrigin = 'https://anomaly-detector.ru'
const productionWebappOrigin = 'https://app.anomaly-detector.ru'

export function loadWebsiteReleaseEnvironment(
  root = fileURLToPath(new URL('.', import.meta.url)),
) {
  return loadEnv('production', root, '')
}

export function validateWebsiteReleaseEnvironment(environment) {
  for (const [name, expected] of [
    ['PUBLIC_WEBSITE_URL', productionWebsiteOrigin],
    ['PUBLIC_WEBAPP_URL', productionWebappOrigin],
  ]) {
    if (environment[name] !== expected) {
      throw new Error(`${name} must equal ${expected} for the split-domain release`)
    }
  }
  for (const name of ['PUBLIC_ANALYTICS_API_URL', 'PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST']) {
    if (environment[name]?.trim()) {
      throw new Error(`${name} must be absent until production analytics is approved`)
    }
  }
}
