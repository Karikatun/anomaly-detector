import { domainToASCII } from 'node:url'

import { MailPolicyFailure } from '../domain/errors'
import {
  APPROVED_MAIL_PROVIDER_CATALOG,
  CONSERVATIVE_MAIL_CANONICALIZATION,
  MAX_CUSTOM_DOMAIN_MX_RECORDS,
  type ApprovedMailProviderId,
  type MailAddressCanonicalization,
} from './approved-mail-provider-catalog'

export { MAX_CUSTOM_DOMAIN_MX_RECORDS } from './approved-mail-provider-catalog'

export type MxResolution =
  | { exchanges: readonly string[]; kind: 'resolved' }
  | { kind: 'invalid_records' }
  | { kind: 'no_mx' }
  | { kind: 'null_mx' }
  | { kind: 'too_many_records' }
  | { kind: 'retry'; reason: 'dns_timeout' | 'dns_unavailable' }

export type MxResolver = {
  resolve(emailDomain: string): Promise<MxResolution>
}

export type AllowedMailDomainClassification = {
  canonicalization: MailAddressCanonicalization
  emailDomain: string
  kind: 'allowed'
  mxExchanges?: string[]
  providerId: ApprovedMailProviderId
  source: 'mx' | 'public_domain'
}

export type DeniedMailDomainReason =
  | 'invalid_domain'
  | 'invalid_mx_record'
  | 'mixed_providers'
  | 'mx_profile_mismatch'
  | 'no_mx'
  | 'null_mx'
  | 'too_many_mx_records'
  | 'unknown_provider'
  | 'unsupported_zone'

export type MailDomainClassification =
  | AllowedMailDomainClassification
  | {
      emailDomain: string | null
      kind: 'denied'
      reason: DeniedMailDomainReason
    }
  | {
      emailDomain: string
      kind: 'retry'
      reason: 'dns_timeout' | 'dns_unavailable'
    }

export function classifyMailDomain(input: {
  emailDomain: string
  mx: MxResolution
}): MailDomainClassification {
  const emailDomain = normalizeDomain(input.emailDomain)
  if (!emailDomain) {
    return { emailDomain: null, kind: 'denied', reason: 'invalid_domain' }
  }

  const publicDomain = findPublicDomain(emailDomain)
  if (publicDomain) {
    return {
      canonicalization: publicDomain.canonicalization,
      emailDomain,
      kind: 'allowed',
      providerId: publicDomain.providerId,
      source: 'public_domain',
    }
  }

  if (!hasSupportedCustomDomainZone(emailDomain)) {
    return { emailDomain, kind: 'denied', reason: 'unsupported_zone' }
  }

  if (input.mx.kind === 'retry') {
    return { emailDomain, kind: 'retry', reason: input.mx.reason }
  }
  if (input.mx.kind === 'no_mx') {
    return { emailDomain, kind: 'denied', reason: 'no_mx' }
  }
  if (input.mx.kind === 'null_mx') {
    return { emailDomain, kind: 'denied', reason: 'null_mx' }
  }
  if (input.mx.kind === 'too_many_records') {
    return { emailDomain, kind: 'denied', reason: 'too_many_mx_records' }
  }
  if (input.mx.kind === 'invalid_records') {
    return { emailDomain, kind: 'denied', reason: 'invalid_mx_record' }
  }

  if (input.mx.exchanges.length === 0) {
    return { emailDomain, kind: 'denied', reason: 'no_mx' }
  }
  if (input.mx.exchanges.length > MAX_CUSTOM_DOMAIN_MX_RECORDS) {
    return { emailDomain, kind: 'denied', reason: 'too_many_mx_records' }
  }
  if (input.mx.exchanges.some((exchange) => exchange.trim() === '.')) {
    return { emailDomain, kind: 'denied', reason: 'null_mx' }
  }

  const mxExchanges = normalizeMxExchanges(input.mx.exchanges)
  if (!mxExchanges) {
    return { emailDomain, kind: 'denied', reason: 'invalid_mx_record' }
  }

  const exactProvider = APPROVED_MAIL_PROVIDER_CATALOG.providers.find((provider) =>
    provider.customDomain
    && equalStringSets(mxExchanges, provider.customDomain.mxExchanges))
  if (exactProvider?.customDomain) {
    if (!exactProvider.customDomain.allowedZones.some((zone) => hasZone(emailDomain, zone))) {
      return { emailDomain, kind: 'denied', reason: 'unsupported_zone' }
    }
    return {
      canonicalization: CONSERVATIVE_MAIL_CANONICALIZATION,
      emailDomain,
      kind: 'allowed',
      mxExchanges,
      providerId: exactProvider.providerId,
      source: 'mx',
    }
  }

  const matchedProviderIds = new Set<ApprovedMailProviderId>()
  for (const provider of APPROVED_MAIL_PROVIDER_CATALOG.providers) {
    if (!provider.customDomain) continue
    if (provider.customDomain.mxExchanges.some((exchange) => mxExchanges.includes(exchange))) {
      matchedProviderIds.add(provider.providerId)
    }
  }

  if (matchedProviderIds.size > 1) {
    return { emailDomain, kind: 'denied', reason: 'mixed_providers' }
  }
  if (matchedProviderIds.size === 1) {
    return { emailDomain, kind: 'denied', reason: 'mx_profile_mismatch' }
  }
  return { emailDomain, kind: 'denied', reason: 'unknown_provider' }
}

export function normalizeMailDomain(value: string) {
  const ascii = domainToASCII(value.trim().replace(/\.$/, '')).toLowerCase()
  const labels = ascii.split('.')
  if (
    ascii.length < 1
    || ascii.length > 253
    || labels.length < 2
    || labels.some((label) => label.length < 1
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new MailPolicyFailure('invalid_domain', 'Mail domain is invalid')
  }
  return ascii
}

function normalizeDomain(value: string) {
  try {
    return normalizeMailDomain(value)
  } catch {
    return null
  }
}

function normalizeMxExchanges(exchanges: readonly string[]) {
  const normalized: string[] = []
  for (const exchange of exchanges) {
    const domain = normalizeDomain(exchange)
    if (!domain) return null
    normalized.push(domain)
  }
  return [...new Set(normalized)].sort()
}

function findPublicDomain(emailDomain: string) {
  for (const provider of APPROVED_MAIL_PROVIDER_CATALOG.providers) {
    const publicDomain = provider.publicDomains.find((entry) => entry.emailDomain === emailDomain)
    if (publicDomain) {
      return {
        canonicalization: publicDomain.canonicalization,
        providerId: provider.providerId,
      }
    }
  }
  return null
}

function hasSupportedCustomDomainZone(emailDomain: string) {
  return hasZone(emailDomain, 'ru') || hasZone(emailDomain, 'xn--p1ai')
}

function hasZone(emailDomain: string, zone: string) {
  return emailDomain.endsWith(`.${zone}`)
}

function equalStringSets(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false
  const sortedRight = [...right].sort()
  return left.every((value, index) => value === sortedRight[index])
}
