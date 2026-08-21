import { domainToASCII } from 'node:url'

import type {
  ImportedMailServiceCandidate,
  ImportedMailServiceCandidates,
} from '../application/ports'

const METADATA_URL = 'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/meta.csv'
const DATASET_PATH = '/opendata/7705846236-InformationDistributor/'
const DATASET_IDENTIFIER = '7705846236-InformationDistributor'
const DATASET_NAMESPACE = 'http://rsoc.ru/opendata/7705846236-InformationDistributor'
const MAX_METADATA_BYTES = 512 * 1024
const MAX_REGISTRY_BYTES = 8 * 1024 * 1024
const MAX_METADATA_ROWS = 1_000
const MAX_RECORDS = 10_000
const MAX_SERVICES = 20_000
const MAX_CANDIDATES = 5_000
const FETCH_TIMEOUT_MS = 10_000

type HttpFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type RknMailSourceFailureCode =
  | 'empty_candidates'
  | 'metadata_invalid'
  | 'registry_invalid'
  | 'source_boundary_invalid'
  | 'source_too_large'
  | 'source_unavailable'

export class RknMailSourceFailure extends Error {
  constructor(
    public readonly code: RknMailSourceFailureCode,
    message: string,
  ) {
    super(message)
  }
}

export class RknMailServiceCandidateSource {
  constructor(
    private readonly fetcher: HttpFetcher = (input, init) => globalThis.fetch(input, init),
  ) {}

  async load(): Promise<ImportedMailServiceCandidates> {
    const metadata = await this.fetchText(METADATA_URL, MAX_METADATA_BYTES)
    const target = parseMetadata(metadata)
    const registry = await this.fetchText(target.sourceUrl, MAX_REGISTRY_BYTES)
    const candidates = parseRegistry(registry)
    if (candidates.length === 0) {
      throw new RknMailSourceFailure('empty_candidates', 'Registry contains no mail-service candidates')
    }
    return {
      candidates,
      checksum: await sha256(registry),
      sourceDate: target.sourceDate,
      sourceUrl: target.sourceUrl,
    }
  }

  private async fetchText(url: string, maxBytes: number) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      let response: Response
      try {
        response = await this.fetcher(url, {
          headers: { Accept: 'text/csv, application/xml, text/xml;q=0.9' },
          redirect: 'error',
          signal: controller.signal,
        })
      } catch {
        throw new RknMailSourceFailure('source_unavailable', 'Registry source is unavailable')
      }
      if (!response.ok) {
        throw new RknMailSourceFailure('source_unavailable', 'Registry source returned an error')
      }
      const declaredLength = response.headers.get('content-length')
      if (declaredLength !== null) {
        const parsedLength = Number(declaredLength)
        if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
          throw new RknMailSourceFailure('source_too_large', 'Registry source exceeds the size limit')
        }
      }
      return decodeUtf8(await readBounded(response, maxBytes))
    } finally {
      clearTimeout(timeout)
    }
  }
}

function parseMetadata(csv: string) {
  let rows: string[][]
  try {
    rows = parseCsv(csv, MAX_METADATA_ROWS)
  } catch {
    throw new RknMailSourceFailure('metadata_invalid', 'Registry metadata is malformed')
  }
  if (rows.length < 2 || rows[0]?.length !== 2 || rows[0][0] !== 'property' || rows[0][1] !== 'value') {
    throw new RknMailSourceFailure('metadata_invalid', 'Registry metadata header is invalid')
  }
  const properties = new Map<string, string>()
  for (const row of rows.slice(1)) {
    if (row.length !== 2 || row[0].length > 128 || row[1].length > 2_048) {
      throw new RknMailSourceFailure('metadata_invalid', 'Registry metadata row is invalid')
    }
    if (properties.has(row[0])) {
      throw new RknMailSourceFailure('metadata_invalid', 'Registry metadata contains duplicate properties')
    }
    properties.set(row[0], row[1])
  }
  if (properties.get('identifier') !== DATASET_IDENTIFIER || properties.get('format') !== 'XML') {
    throw new RknMailSourceFailure('metadata_invalid', 'Registry metadata identifies an unexpected dataset')
  }
  const sourceDate = properties.get('modified')
  if (!sourceDate || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) {
    throw new RknMailSourceFailure('metadata_invalid', 'Registry metadata source date is invalid')
  }
  const targets = [...properties.entries()]
    .filter(([property]) => /^data-\d{8}T\d{4}-structure-\d{8}T\d{4}$/.test(property))
    .sort(([left], [right]) => right.localeCompare(left))
  const [property, sourceUrl] = targets[0] ?? []
  if (!property || !sourceUrl) {
    throw new RknMailSourceFailure('metadata_invalid', 'Registry metadata has no XML export')
  }
  assertOfficialDataUrl(sourceUrl, `${property}.xml`)
  return { sourceDate, sourceUrl }
}

function assertOfficialDataUrl(value: string, expectedFileName: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new RknMailSourceFailure('source_boundary_invalid', 'Registry export URL is invalid')
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'rkn.gov.ru'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || url.pathname !== `${DATASET_PATH}${expectedFileName}`
  ) {
    throw new RknMailSourceFailure('source_boundary_invalid', 'Registry export left the approved source boundary')
  }
}

function parseRegistry(xml: string): ImportedMailServiceCandidate[] {
  const withoutDeclaration = xml.replace(/^\s*<\?xml[^?]*\?>/, '')
  if (
    xml.includes('<!')
    || withoutDeclaration.includes('<?')
    || /<\/?(?!rkn:)[A-Za-z_][A-Za-z0-9_.:-]*(?:\s|\/?>)/.test(withoutDeclaration)
  ) {
    throw new RknMailSourceFailure('registry_invalid', 'Registry XML contains unsupported declarations')
  }
  if (!xml.includes(`xmlns:rkn="${DATASET_NAMESPACE}"`) || !xml.includes('<rkn:register')) {
    throw new RknMailSourceFailure('registry_invalid', 'Registry XML namespace is invalid')
  }
  const allowedElements = new Set([
    'accessLimited',
    'description',
    'distributorEmail',
    'distributorINN',
    'distributorLegalAddress',
    'distributorName',
    'distributorOGRN',
    'distributorPersons',
    'distributorPostAddress',
    'distributorRegNo',
    'domain',
    'email',
    'entryDate',
    'entryNum',
    'record',
    'register',
    'service',
    'services',
  ])
  for (const match of xml.matchAll(/<\/?rkn:([A-Za-z][A-Za-z0-9]*)\b/g)) {
    if (!allowedElements.has(match[1])) {
      throw new RknMailSourceFailure('registry_invalid', 'Registry XML schema contains an unknown element')
    }
  }
  const records = extractElements(xml, 'record', MAX_RECORDS)
  if (records.length === 0) {
    throw new RknMailSourceFailure('registry_invalid', 'Registry XML contains no records')
  }
  const candidates: ImportedMailServiceCandidate[] = []
  let serviceCount = 0
  for (const record of records) {
    if (record.length > 256 * 1024) {
      throw new RknMailSourceFailure('registry_invalid', 'Registry record exceeds its size bound')
    }
    const registryEntryId = decodeXmlText(extractSingle(record, 'entryNum', 64)).trim()
    if (!registryEntryId || !/^[A-Za-zА-Яа-я0-9._/-]+$/u.test(registryEntryId)) {
      throw new RknMailSourceFailure('registry_invalid', 'Registry entry identifier is invalid')
    }
    extractSingle(record, 'entryDate', 32)
    extractSingle(record, 'distributorName', 2_048)
    extractSingle(record, 'distributorEmail', 2_048)
    const servicesContainer = extractSingle(record, 'services', 256 * 1024)
    const services = extractElements(servicesContainer, 'service', MAX_SERVICES - serviceCount)
    serviceCount += services.length
    if (services.length === 0 || serviceCount > MAX_SERVICES) {
      throw new RknMailSourceFailure('registry_invalid', 'Registry service collection is invalid')
    }
    for (const service of services) {
      const rawDomains = decodeXmlText(extractSingle(service, 'domain', 2_048))
      const description = decodeXmlText(extractSingle(service, 'description', 8_192))
      extractSingle(service, 'email', 2_048)
      const accessLimited = decodeXmlText(extractSingle(service, 'accessLimited', 16)).trim()
      if (accessLimited !== 'true' && accessLimited !== 'false') {
        throw new RknMailSourceFailure('registry_invalid', 'Registry service access flag is invalid')
      }
      if (!mentionsMailService(description)) continue
      for (const serviceDomain of normalizeSourceDomains(rawDomains)) {
        candidates.push({
          evidence: 'service_description_mentions_mail',
          registryEntryId,
          serviceDomain,
        })
        if (candidates.length > MAX_CANDIDATES) {
          throw new RknMailSourceFailure('registry_invalid', 'Registry candidate collection exceeds its bound')
        }
      }
    }
  }
  const unique = new Map<string, ImportedMailServiceCandidate>()
  for (const candidate of candidates) {
    unique.set(`${candidate.registryEntryId}\u0000${candidate.serviceDomain}`, candidate)
  }
  return [...unique.values()].sort((left, right) =>
    left.serviceDomain.localeCompare(right.serviceDomain)
      || left.registryEntryId.localeCompare(right.registryEntryId))
}

function extractElements(input: string, name: string, max: number) {
  if (max < 1) return []
  const opening = new RegExp(`<rkn:${name}(?:\\s[^>]*)?>`, 'g')
  const closing = new RegExp(`</rkn:${name}\\s*>`, 'g')
  const values = [...input.matchAll(new RegExp(`<rkn:${name}(?:\\s[^>]*)?>([\\s\\S]*?)</rkn:${name}\\s*>`, 'g'))]
    .map((match) => match[1])
  if (values.length > max || [...input.matchAll(opening)].length !== values.length || [...input.matchAll(closing)].length !== values.length) {
    throw new RknMailSourceFailure('registry_invalid', `Registry ${name} elements are malformed`)
  }
  return values
}

function extractSingle(input: string, name: string, maxLength: number) {
  const values = extractElements(input, name, 2)
  if (values.length !== 1 || values[0].length > maxLength) {
    throw new RknMailSourceFailure('registry_invalid', `Registry ${name} element is invalid`)
  }
  return values[0]
}

function normalizeSourceDomains(value: string) {
  const values = value.split(/[\s,;]+/).filter(Boolean)
  if (values.length === 0 || values.length > 20) {
    throw new RknMailSourceFailure('registry_invalid', 'Registry service domain list is invalid')
  }
  return values.map((item) => {
    const ascii = domainToASCII(item.trim().replace(/\.$/, '')).toLowerCase()
    if (!isDomain(ascii)) {
      throw new RknMailSourceFailure('registry_invalid', 'Registry service domain is invalid')
    }
    return ascii
  })
}

function isDomain(value: string) {
  if (value.length < 1 || value.length > 253 || value.includes('..')) return false
  const labels = value.split('.')
  return labels.length >= 2 && labels.every((label) =>
    label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
}

function mentionsMailService(value: string) {
  const normalized = value.toLocaleLowerCase('ru-RU')
  return normalized.includes('почт') || /(^|[^a-z])e-?mail([^a-z]|$)/.test(normalized)
}

function decodeXmlText(value: string) {
  return value.replace(/&(?:#\d+|#x[0-9a-fA-F]+|amp|apos|gt|lt|quot);/g, (entity) => {
    if (entity === '&amp;') return '&'
    if (entity === '&apos;') return "'"
    if (entity === '&gt;') return '>'
    if (entity === '&lt;') return '<'
    if (entity === '&quot;') return '"'
    const codePoint = entity.startsWith('&#x')
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number.parseInt(entity.slice(2, -1), 10)
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      throw new RknMailSourceFailure('registry_invalid', 'Registry XML entity is invalid')
    }
    return String.fromCodePoint(codePoint)
  }).replace(/&[^;\s]{1,32};/g, () => {
    throw new RknMailSourceFailure('registry_invalid', 'Registry XML entity is unsupported')
  })
}

function parseCsv(input: string, maxRows: number) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
        closedQuote = true
      } else {
        field += char
      }
      continue
    }
    if (closedQuote && char !== ',' && char !== '\r' && char !== '\n') throw new Error('invalid csv')
    if (char === '"') {
      if (field.length > 0 || closedQuote) throw new Error('invalid csv')
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      closedQuote = false
      continue
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && input[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      if (rows.length > maxRows) throw new Error('too many rows')
      row = []
      field = ''
      closedQuote = false
      continue
    }
    field += char
  }
  if (quoted) throw new Error('unterminated quote')
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

async function readBounded(response: Response, maxBytes: number) {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new RknMailSourceFailure('source_too_large', 'Registry source exceeds the size limit')
    }
    chunks.push(value)
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function decodeUtf8(value: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value).replace(/^\uFEFF/, '')
  } catch {
    throw new RknMailSourceFailure('registry_invalid', 'Registry source is not valid UTF-8')
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
