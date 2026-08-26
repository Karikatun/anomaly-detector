import { resolveMx as nodeResolveMx } from 'node:dns/promises'

import {
  MAX_CUSTOM_DOMAIN_MX_RECORDS,
  type MxResolution,
  type MxResolver,
  normalizeMailDomain,
} from '../application/mail-domain-classifier'

type MxLookupRecord = {
  exchange: string
  priority: number
}

type MxLookup = (emailDomain: string) => Promise<readonly MxLookupRecord[]>

const DEFAULT_MX_LOOKUP_TIMEOUT_MS = 2_000
const TIMEOUT = Symbol('mx_lookup_timeout')

export class NodeMxResolver implements MxResolver {
  private readonly lookup: MxLookup
  private readonly timeoutMs: number

  constructor(options: {
    lookup?: MxLookup
    timeoutMs?: number
  } = {}) {
    this.lookup = options.lookup ?? nodeResolveMx
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MX_LOOKUP_TIMEOUT_MS
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 10_000) {
      throw new TypeError('MX lookup timeout must be an integer between 1 and 10000 milliseconds')
    }
  }

  async resolve(emailDomainInput: string): Promise<MxResolution> {
    let emailDomain: string
    try {
      emailDomain = normalizeMailDomain(emailDomainInput)
    } catch {
      return { kind: 'invalid_records' }
    }

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        this.lookup(emailDomain),
        new Promise<typeof TIMEOUT>((resolve) => {
          timeout = setTimeout(() => resolve(TIMEOUT), this.timeoutMs)
        }),
      ])
      if (result === TIMEOUT) {
        return { kind: 'retry', reason: 'dns_timeout' }
      }
      return normalizeLookupRecords(result)
    } catch (error) {
      if (isNoMxError(error)) return { kind: 'no_mx' }
      return { kind: 'retry', reason: 'dns_unavailable' }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}

function normalizeLookupRecords(records: readonly MxLookupRecord[]): MxResolution {
  if (!Array.isArray(records)) return { kind: 'invalid_records' }
  if (records.length === 0) return { kind: 'no_mx' }
  if (records.length > MAX_CUSTOM_DOMAIN_MX_RECORDS) return { kind: 'too_many_records' }
  if (records.some((record) => isNullMxRecord(record))) return { kind: 'null_mx' }

  const exchanges: string[] = []
  for (const record of records) {
    if (!isValidLookupRecord(record)) return { kind: 'invalid_records' }
    try {
      exchanges.push(normalizeMailDomain(record.exchange))
    } catch {
      return { kind: 'invalid_records' }
    }
  }
  return {
    exchanges: [...new Set(exchanges)].sort(),
    kind: 'resolved',
  }
}

function isNullMxRecord(record: MxLookupRecord) {
  return record
    && typeof record === 'object'
    && typeof record.exchange === 'string'
    && record.exchange.trim() === '.'
}

function isValidLookupRecord(record: MxLookupRecord) {
  return record
    && typeof record === 'object'
    && typeof record.exchange === 'string'
    && Number.isInteger(record.priority)
    && record.priority >= 0
    && record.priority <= 65_535
}

function isNoMxError(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return error.code === 'ENODATA' || error.code === 'ENOTFOUND'
}
