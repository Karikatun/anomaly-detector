import {
  analyticsEventCommandSchema,
  type AnalyticsLinkedEvent,
} from '@anomaly-detector/contracts'

import { getApiBaseUrl } from '../api/api-base-url'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type BeaconSender = (url: string, data?: BodyInit | null) => boolean

export class ProductAnalytics {
  private readonly apiBaseUrl: string
  private readonly beacon: BeaconSender | null
  private readonly enabled: boolean
  private readonly fetcher: Fetcher

  constructor(input: {
    apiBaseUrl: string
    beacon?: BeaconSender | null
    enabled: boolean
    fetcher?: Fetcher
  }) {
    this.apiBaseUrl = input.apiBaseUrl.replace(/\/$/, '')
    this.beacon = input.beacon === undefined ? browserBeacon() : input.beacon
    this.enabled = input.enabled
    this.fetcher = input.fetcher ?? globalThis.fetch.bind(globalThis)
  }

  async record(event: AnalyticsLinkedEvent): Promise<void> {
    if (!this.enabled) return
    try {
      const body = analyticsEventCommandSchema.parse({ event })
      const url = `${this.apiBaseUrl}/api/analytics/events`
      const payload = JSON.stringify(body)
      if (this.beacon?.(url, payload)) return
      await this.fetcher(url, {
        body: payload,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        method: 'POST',
      })
    } catch {
      // Analytics is optional and must never alter the product journey.
    }
  }
}

function browserBeacon(): BeaconSender | null {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return null
  return navigator.sendBeacon.bind(navigator)
}

export const productAnalytics = new ProductAnalytics({
  apiBaseUrl: getApiBaseUrl(),
  enabled: import.meta.env?.VITE_ANALYTICS_ENABLED === 'true',
})
