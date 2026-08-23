import type {
  AnalyticsSourceCategory,
  AnalyticsTrafficClass,
} from '@anomaly-detector/contracts'

const knownCrawlerTokens = [
  'Googlebot',
  'YandexBot',
  'OAI-SearchBot',
  'GPTBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
] as const

export function classifyAnalyticsTraffic(userAgent: string | undefined): AnalyticsTrafficClass {
  if (!userAgent) return 'human'
  return knownCrawlerTokens.some((token) => userAgent.toLowerCase().includes(token.toLowerCase()))
    ? 'known_bot'
    : 'human'
}

export function classifyAnalyticsSource(input: {
  campaign: string | null
  campaignAllowlist: ReadonlySet<string>
  referrerDomain: string | null
}): AnalyticsSourceCategory {
  if (input.campaign) {
    const normalizedCampaign = input.campaign.toLowerCase()
    if (input.campaignAllowlist.has(normalizedCampaign)) return 'campaign'
    if (!input.referrerDomain) return 'unknown'
  }
  if (input.referrerDomain) return 'referral'
  return 'direct'
}
