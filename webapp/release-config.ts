const productionApiOrigin = 'https://api.anomaly-detector.ru'

const requiredLegalValues = [
  'VITE_PUBLIC_LEGAL_OPERATOR_NAME',
  'VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT',
  'VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS',
  'VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE',
] as const

export function validateWebappReleaseEnvironment(
  environment: Record<string, string | undefined>,
) {
  for (const name of ['VITE_API_URL', 'VITE_OAUTH_API_URL'] as const) {
    if (environment[name] !== productionApiOrigin) {
      throw new Error(`${name} must equal ${productionApiOrigin} for the split-domain release`)
    }
  }

  if (!/^[0-9a-f]{40}$/.test(environment.VITE_BUILD_SHA ?? '')) {
    throw new Error('VITE_BUILD_SHA must be the exact lowercase 40-character release commit')
  }

  if (environment.VITE_ANALYTICS_ENABLED?.trim()) {
    throw new Error('VITE_ANALYTICS_ENABLED must be absent until production analytics is approved')
  }

  for (const name of requiredLegalValues) {
    if (!environment[name]?.trim()) {
      throw new Error(`${name} must be set for a public webapp build`)
    }
  }
}
