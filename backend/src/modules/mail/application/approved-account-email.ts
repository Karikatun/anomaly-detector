import type { MailPolicyDecision } from './ports'
import { normalizeEmailDomain } from './mail-policy-service'

export type ApprovedAccountEmail = {
  canonicalKey: string
  providerValue: string
}

export function accountEmailDomain(value: string) {
  return parseEmailAddress(value)?.domain ?? null
}

export function canonicalizeAccountEmailWithDecision(
  value: string,
  decision: MailPolicyDecision,
): ApprovedAccountEmail | null {
  const parsed = parseEmailAddress(value)
  if (!parsed) return null

  const canonicalization = decision.canonicalization ?? {
    ignoreDots: false,
    localPartCaseInsensitive: false,
    stripPlusTag: false,
  }

  let canonicalLocalPart = parsed.localPart
  if (canonicalization.stripPlusTag) {
    canonicalLocalPart = canonicalLocalPart.split('+', 1)[0] ?? ''
  }
  if (canonicalization.ignoreDots) {
    canonicalLocalPart = canonicalLocalPart.replaceAll('.', '')
  }
  if (canonicalization.localPartCaseInsensitive) {
    canonicalLocalPart = canonicalLocalPart.toLowerCase()
  }
  if (!isValidLocalPart(canonicalLocalPart)) return null

  return {
    canonicalKey: `${canonicalLocalPart}@${parsed.domain}`,
    providerValue: `${parsed.localPart}@${parsed.domain}`,
  }
}

export function createAccountEmailCanonicalizer(policy: {
  evaluate(emailDomain: string, options?: { forceMxRefresh?: boolean }): Promise<MailPolicyDecision>
}) {
  return {
    async canonicalize(value: string): Promise<ApprovedAccountEmail | null> {
      const result = await canonicalizeWithPolicy(value, policy)
      return result ? result.email : null
    },
    async canonicalizeForRecovery(
      value: string,
      options: { forceMxRefresh?: boolean } = { forceMxRefresh: true },
    ) {
      const result = await canonicalizeWithPolicy(value, policy, options)
      if (!result?.decision.acceptsNewAddress) return null
      return {
        ...result.email,
        policyVersion: result.decision.version,
      }
    },
    evaluate: (emailDomain: string) => policy.evaluate(normalizeEmailDomain(emailDomain)),
    evaluateFresh: (emailDomain: string) => policy.evaluate(
      normalizeEmailDomain(emailDomain),
      { forceMxRefresh: true },
    ),
  }
}

async function canonicalizeWithPolicy(
  value: string,
  policy: { evaluate(emailDomain: string, options?: { forceMxRefresh?: boolean }): Promise<MailPolicyDecision> },
  options?: { forceMxRefresh?: boolean },
) {
  const parsed = parseEmailAddress(value)
  if (!parsed) return null

  const decision = await policy.evaluate(parsed.domain, options)
  const email = canonicalizeAccountEmailWithDecision(value, decision)
  if (!email) return null

  return {
    decision,
    email,
  }
}

function parseEmailAddress(value: string) {
  if (value.length < 3 || value.length > 320) return null
  const separator = value.lastIndexOf('@')
  if (separator < 1 || separator !== value.indexOf('@')) return null
  const localPart = value.slice(0, separator)
  if (!isValidLocalPart(localPart)) return null

  let domain: string
  try {
    domain = normalizeEmailDomain(value.slice(separator + 1))
  } catch {
    return null
  }
  if (`${localPart}@${domain}`.length > 254) return null
  return { domain, localPart }
}

function isValidLocalPart(value: string) {
  return value.length >= 1
    && value.length <= 64
    && !value.startsWith('.')
    && !value.endsWith('.')
    && !value.includes('..')
    && !/[\s\u0000-\u001f\u007f@]/u.test(value)
}
