import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const productionWebsiteOrigin = 'https://anomaly-detector.ru'
const productionWebappOrigin = 'https://app.anomaly-detector.ru'

export function loadWebsiteReleaseEnvironment(
  root = fileURLToPath(new URL('.', import.meta.url)),
) {
  return loadEnv('production', root, '')
}

export function validateWebsiteReleaseEnvironment(environment, { analytics = false } = {}) {
  for (const [name, expected] of [
    ['PUBLIC_WEBSITE_URL', productionWebsiteOrigin],
    ['PUBLIC_WEBAPP_URL', productionWebappOrigin],
  ]) {
    if (environment[name] !== expected) {
      throw new Error(`${name} must equal ${expected} for the split-domain release`)
    }
  }
  if (analytics) {
    if (environment.PUBLIC_ANALYTICS_MODE !== 'aggregate') {
      throw new Error('PUBLIC_ANALYTICS_MODE must equal aggregate for the analytics release')
    }
    if (environment.PUBLIC_ANALYTICS_API_URL !== 'https://api.anomaly-detector.ru') {
      throw new Error('PUBLIC_ANALYTICS_API_URL must equal https://api.anomaly-detector.ru for the analytics release')
    }
    const campaigns = (environment.PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST ?? '')
      .split(',').map((value) => value.trim()).filter(Boolean)
    if (campaigns.length > 100 || campaigns.some((value) => !/^[a-z0-9_-]{1,64}$/.test(value))) {
      throw new Error('PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST must contain at most 100 approved lowercase campaign keys')
    }
  } else {
    for (const name of ['PUBLIC_ANALYTICS_API_URL', 'PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST', 'PUBLIC_ANALYTICS_MODE']) {
      if (environment[name]?.trim()) {
        throw new Error(`${name} must be absent until production analytics is approved`)
      }
    }
  }
}
