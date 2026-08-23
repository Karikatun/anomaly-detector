import type {
  AnalyticsAdminOverview,
  AnalyticsAdminQuery,
  AnalyticsConsentStatus,
  AnalyticsLinkedEvent,
  AnalyticsTrafficClass,
} from '@anomaly-detector/contracts'

export type AnalyticsSourceInput = {
  campaign: string | null
  referrerDomain: string | null
  trafficClass: AnalyticsTrafficClass
}

export type AnalyticsGrantInput = AnalyticsSourceInput & {
  commandId: string
}

export type AnalyticsGrant = {
  expiresAt: Date
  token: string
}

export type AnalyticsStore = {
  cleanup(now: Date): Promise<{ aggregates: number; journeys: number }>
  grant(input: AnalyticsGrantInput): Promise<AnalyticsGrant>
  readOverview(query: AnalyticsAdminQuery): Promise<AnalyticsAdminOverview>
  recordEvent(token: string, event: AnalyticsLinkedEvent): Promise<boolean>
  recordLandingView(input: AnalyticsSourceInput): Promise<void>
  revoke(token: string): Promise<boolean>
  status(token: string): Promise<AnalyticsConsentStatus>
}
