import type {
  FeedbackRouteTemplate,
  FeedbackTechnicalContext,
} from '@anomaly-detector/contracts'

const exactRoutes = new Set<FeedbackRouteTemplate>([
  '/',
  '/app',
  '/profile',
  '/recover/code',
  '/recover/password',
  '/rooms',
  '/tutorial',
  '/privacy',
  '/personal-data-consent',
  '/terms',
  '/feedback',
])

export function buildFeedbackTechnicalContext(input: {
  buildSha?: string
  pathname: string
  userAgent: string
  viewportWidth: number
}): FeedbackTechnicalContext {
  return {
    browserClass: browserClass(input.userAgent),
    buildSha: /^[a-f0-9]{40}$/i.test(input.buildSha ?? '')
      ? input.buildSha!.toLowerCase()
      : null,
    deviceClass: deviceClass(input.viewportWidth),
    errorId: null,
    routeTemplate: routeTemplate(input.pathname),
  }
}

function routeTemplate(pathname: string): FeedbackRouteTemplate {
  if (exactRoutes.has(pathname as FeedbackRouteTemplate)) {
    return pathname as FeedbackRouteTemplate
  }
  if (/^\/rooms\/[^/?#]+$/.test(pathname)) return '/rooms/$roomId'
  if (/^\/tenders\/[^/?#]+$/.test(pathname)) return '/tenders/$tenderId'
  return 'unknown'
}

function deviceClass(width: number): FeedbackTechnicalContext['deviceClass'] {
  if (!Number.isFinite(width) || width <= 0) return 'unknown'
  if (width <= 640) return 'mobile'
  if (width <= 1_024) return 'tablet'
  return 'desktop'
}

function browserClass(userAgent: string): FeedbackTechnicalContext['browserClass'] {
  if (!userAgent) return 'unknown'
  if (/firefox|fxios/i.test(userAgent)) return 'firefox'
  if (/chrome|chromium|crios|edg/i.test(userAgent)) return 'chromium'
  if (/safari|applewebkit/i.test(userAgent)) return 'webkit'
  return 'other'
}
