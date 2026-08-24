export const disabledWebappAnalyticsEnvironment = [
  'VITE_ANALYTICS_ENABLED',
]

export const disabledWebsiteAnalyticsEnvironment = [
  'PUBLIC_ANALYTICS_API_URL',
  'PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST',
]

export function withoutEnvironment(baseEnvironment, overrides, names) {
  const environment = { ...baseEnvironment, ...overrides }
  for (const name of names) delete environment[name]
  return environment
}

export function assertExcludesLocalServiceOrigins(output, label) {
  const localServiceOrigin = output.match(
    /https?:\/\/(?:localhost(?::\d+|(?=[/?#]))|0\.0\.0\.0(?::\d+)?|127(?:\.\d{1,3}){3}(?::\d+)?|\[::1\](?::\d+)?|(?:[a-z0-9-]+\.)+localhost(?::\d+)?)(?=[/?#"'`\s\\]|$)/i,
  )?.[0]
  if (localServiceOrigin) {
    throw new Error(`${label} contains a local test service origin`)
  }
}
