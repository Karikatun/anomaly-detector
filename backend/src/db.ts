import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from './generated/prisma/client'

export function createPrisma(connectionString: string) {
  const adapter = new PrismaPg({ connectionString: normalizePgConnectionString(connectionString) })
  return new PrismaClient({ adapter })
}

export type DbClient = ReturnType<typeof createPrisma>

export function isRetryableDatabaseTransactionConflict(error: unknown) {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === 'P2034') return true
  if (isRetryableTransactionCause(error)) return true

  const cause = 'cause' in error ? error.cause : undefined
  if (isRetryableTransactionCause(cause)) return true

  const meta = 'meta' in error ? error.meta : undefined
  if (typeof meta !== 'object' || meta === null || !('driverAdapterError' in meta)) return false
  const driverAdapterError = meta.driverAdapterError
  return typeof driverAdapterError === 'object'
    && driverAdapterError !== null
    && 'cause' in driverAdapterError
    && isRetryableTransactionCause(driverAdapterError.cause)
}

function isRetryableTransactionCause(value: unknown) {
  if (typeof value !== 'object' || value === null) return false
  if ('kind' in value && value.kind === 'TransactionWriteConflict') return true
  return 'kind' in value
    && value.kind === 'postgres'
    && 'code' in value
    && (value.code === '40P01' || value.code === '40001')
}

export function normalizePgConnectionString(connectionString: string) {
  const url = new URL(connectionString)
  const sslMode = url.searchParams.get('sslmode')
  const useLibpqCompat = url.searchParams.get('uselibpqcompat')

  if (sslMode === 'require' && useLibpqCompat === null) {
    url.searchParams.set('uselibpqcompat', 'true')
  }

  return url.toString()
}
