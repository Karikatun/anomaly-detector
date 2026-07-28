import { createHmac } from 'node:crypto'

import type { DbClient } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import type { AuthRepository } from '../application/ports'
import { AuthFailure } from '../domain/errors'

const registrationDeviceWindowMs = 180 * 24 * 60 * 60 * 1_000
const registrationIpWindowMs = 24 * 60 * 60 * 1_000

export function createPrismaAuthRepository(db: DbClient, abuseSecret: string): AuthRepository {
  return {
    findUserByLogin(login) {
      return db.user.findUnique({ where: { login } })
    },

    async updatePasswordHash({ userId, currentPasswordHash, nextPasswordHash }) {
      await db.user.updateMany({
        where: { id: userId, passwordHash: currentPasswordHash },
        data: { passwordHash: nextPasswordHash },
      })
    },

    async createPasswordUserWithSession(input) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            if (input.registration) {
              const quotaKeys = [
                ...(input.registration.deviceId
                  ? [{
                      keyHash: hashRegistrationKey(abuseSecret, 'device', input.registration.deviceId),
                      scope: 'registration_device',
                    }]
                  : []),
                {
                  keyHash: hashRegistrationKey(
                    abuseSecret,
                    'ip',
                    input.registration.ipAddress ?? 'unknown',
                  ),
                  scope: 'registration_ip',
                },
              ].sort((left, right) =>
                `${left.scope}:${left.keyHash}`.localeCompare(`${right.scope}:${right.keyHash}`))
              for (const quota of quotaKeys) {
                await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${quota.scope}:${quota.keyHash}`}, 0))::text AS "lock"`
              }
              if (input.registration.deviceId) {
                await consumeRegistrationQuota(tx, {
                  keyHash: quotaKeys.find((quota) => quota.scope === 'registration_device')!.keyHash,
                  limit: 3,
                  now: input.registration.now,
                  scope: 'registration_device',
                  windowMs: registrationDeviceWindowMs,
                })
              }
              await consumeRegistrationQuota(tx, {
                keyHash: quotaKeys.find((quota) => quota.scope === 'registration_ip')!.keyHash,
                limit: 20,
                now: input.registration.now,
                scope: 'registration_ip',
                windowMs: registrationIpWindowMs,
              })
            }
            const user = await tx.user.create({
              data: {
                login: input.user.login,
                passwordHash: input.user.passwordHash,
                displayName: input.user.displayName,
                privacyConsentAt: input.user.legalAcceptedAt,
                privacyConsentVersion: input.user.privacyConsentVersion,
                termsAcceptedAt: input.user.legalAcceptedAt,
                termsVersion: input.user.termsVersion,
              },
            })
            const session = await tx.authSession.create({
              data: {
                userId: user.id,
                refreshTokenHash: input.session.refreshTokenHash,
                refreshTokenFamilyHash: input.session.refreshTokenFamilyHash,
                expiresAt: input.session.expiresAt,
                userAgent: input.session.metadata.userAgent,
                ipAddress: input.session.metadata.ipAddress,
              },
              select: { id: true },
            })

            return { user, session }
          })
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          if (isUniqueConstraintError(error)) {
            throw new AuthFailure('login_already_exists', 'User with this login already exists')
          }
          throw error
        }
      }
      throw new Error('Unreachable registration transaction retry state')
    },

    createSession(input) {
      return db.authSession.create({
        data: {
          userId: input.userId,
          refreshTokenHash: input.refreshTokenHash,
          refreshTokenFamilyHash: input.refreshTokenFamilyHash,
          expiresAt: input.expiresAt,
          userAgent: input.metadata.userAgent,
          ipAddress: input.metadata.ipAddress,
        },
        select: { id: true },
      })
    },

    async findActiveRefreshSession(input) {
      const family = await db.authSession.findFirst({
        where: {
          refreshTokenFamilyHash: input.refreshTokenFamilyHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
      if (family) {
        if (family.refreshTokenHash === input.refreshTokenHash) {
          return { ...family, credentialState: 'current' as const }
        }

        const isPrevious = family.previousRefreshTokenHash === input.refreshTokenHash
        const withinGrace =
          isPrevious &&
          family.refreshRotatedAt !== null &&
          family.refreshRotatedAt >= input.reuseGraceAfter
        return {
          ...family,
          credentialState: withinGrace
            ? ('previous_within_grace' as const)
            : ('reused' as const),
        }
      }

      const current = await db.authSession.findFirst({
        where: {
          refreshTokenHash: input.refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
      if (current) {
        return { ...current, credentialState: 'current' as const }
      }

      const previous = await db.authSession.findFirst({
        where: {
          previousRefreshTokenHash: input.refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
      if (!previous) return null

      const withinGrace =
        previous.refreshRotatedAt !== null && previous.refreshRotatedAt >= input.reuseGraceAfter
      return {
        ...previous,
        credentialState: withinGrace
          ? ('previous_within_grace' as const)
          : ('reused' as const),
      }
    },

    rotateRefreshSession(input) {
      return db.authSession.updateMany({
        where: {
          id: input.currentSessionId,
          refreshTokenHash: input.currentRefreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
        },
        data: {
          previousRefreshTokenHash: input.currentRefreshTokenHash,
          refreshTokenHash: input.nextRefreshTokenHash,
          refreshTokenFamilyHash: input.nextRefreshTokenFamilyHash,
          refreshRotatedAt: input.now,
          expiresAt: input.nextExpiresAt,
          userAgent: input.metadata.userAgent,
          ipAddress: input.metadata.ipAddress,
        },
      }).then(({ count }) => count === 1)
    },

    revokeSessionById(input) {
      return db.authSession.updateMany({
        where: { id: input.sessionId, revokedAt: null },
        data: { revokedAt: input.now },
      }).then(({ count }) => count === 1)
    },

    findActiveAccessSession(input) {
      return db.authSession.findFirst({
        where: {
          id: input.sessionId,
          userId: input.userId,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
    },

    revokeSession(input) {
      return db.$transaction(async (tx) => {
        const session = await tx.authSession.findFirst({
          where: {
            OR: [
              { refreshTokenHash: input.refreshTokenHash },
              { previousRefreshTokenHash: input.refreshTokenHash },
              { refreshTokenFamilyHash: input.refreshTokenFamilyHash },
            ],
            revokedAt: null,
          },
          select: { id: true, userId: true },
        })
        if (!session) return null

        const revoked = await tx.authSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: input.now },
        })
        return revoked.count === 1 ? session.userId : null
      })
    },

    async createOAuthTransaction(transaction) {
      await db.oAuthTransaction.create({
        data: {
          codeVerifier: transaction.codeVerifier,
          expiresAt: transaction.expiresAt,
          legalAcceptedAt: transaction.legalAcceptance?.acceptedAt,
          privacyConsentVersion: transaction.legalAcceptance?.privacyConsentVersion,
          provider: transaction.provider,
          redirectUri: transaction.redirectUri,
          stateHash: await sha256(transaction.state),
          termsVersion: transaction.legalAcceptance?.termsVersion,
        },
      })
    },

    async consumeOAuthTransactionByState({ now, state }) {
      const stateHash = await sha256(state)
      return db.$transaction(async (tx) => {
        const transaction = await tx.oAuthTransaction.findUnique({
          where: { stateHash },
        })
        if (!transaction || transaction.provider !== 'yandex' || transaction.expiresAt <= now) {
          return null
        }
        const consumed = await tx.oAuthTransaction.deleteMany({
          where: {
            expiresAt: { gt: now },
            provider: 'yandex',
            stateHash,
          },
        })
        if (consumed.count !== 1) return null
        return {
          codeVerifier: transaction.codeVerifier,
          expiresAt: transaction.expiresAt,
          ...(transaction.legalAcceptedAt && transaction.privacyConsentVersion && transaction.termsVersion ? {
            legalAcceptance: {
              acceptedAt: transaction.legalAcceptedAt,
              privacyConsentVersion: transaction.privacyConsentVersion,
              termsVersion: transaction.termsVersion,
            },
          } : {}),
          provider: transaction.provider,
          redirectUri: transaction.redirectUri,
          state,
        }
      })
    },

    async findUserByIdentity({ provider, subject }) {
      const identity = await db.authIdentity.findUnique({
        where: { provider_subject: { provider, subject } },
        include: { user: true },
      })
      return identity?.user ?? null
    },

    async createOAuthUserWithSession(input) {
      const { user: userData, identity: identityData, session: sessionData } = input
      return await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            login: userData.login,
            passwordHash: 'OAUTH_USER',
            displayName: userData.displayName ?? null,
            privacyConsentAt: userData.legalAcceptance.acceptedAt,
            privacyConsentVersion: userData.legalAcceptance.privacyConsentVersion,
            termsAcceptedAt: userData.legalAcceptance.acceptedAt,
            termsVersion: userData.legalAcceptance.termsVersion,
          },
        })
        await tx.authIdentity.create({
          data: {
            userId: user.id,
            provider: identityData.provider,
            subject: identityData.subject,
          },
        })
        const session = await tx.authSession.create({
          data: {
            userId: user.id,
            refreshTokenHash: sessionData.refreshTokenHash,
            refreshTokenFamilyHash: sessionData.refreshTokenFamilyHash,
            expiresAt: sessionData.expiresAt,
            userAgent: sessionData.metadata.userAgent,
            ipAddress: sessionData.metadata.ipAddress,
          },
          select: { id: true },
        })
        return { user, session }
      })
    },

    async eraseUserIdentity({ userId, now }) {
      await db.$transaction(async (tx) => {
        await tx.authIdentity.deleteMany({ where: { userId } })
        await tx.authSession.deleteMany({ where: { userId } })
        await tx.currentMatch.deleteMany({ where: { userId } })
        await tx.tenderRoomMember.deleteMany({ where: { userId } })
        await tx.user.update({
          where: { id: userId },
          data: {
            anonymizedAt: now,
            displayName: null,
            locale: 'ru',
            login: `deleted-${crypto.randomUUID()}`,
            passwordHash: 'ANONYMIZED',
            privacyConsentAt: null,
            privacyConsentVersion: null,
            termsAcceptedAt: null,
            termsVersion: null,
          },
        })
      })
    },

    async updateUser({ userId, displayName, locale }) {
      const data: Record<string, string | null> = {}
      if (displayName !== undefined) data.displayName = displayName
      if (locale !== undefined) data.locale = locale
      await db.user.update({ where: { id: userId }, data })
    },
  }
}

async function consumeRegistrationQuota(
  tx: Prisma.TransactionClient,
  input: {
    keyHash: string
    limit: number
    now: Date
    scope: string
    windowMs: number
  },
) {
  const existing = await tx.authAbuseBucket.findUnique({
    where: { scope_keyHash: { scope: input.scope, keyHash: input.keyHash } },
  })
  const windowExpired = !existing || existing.expiresAt <= input.now
  const count = windowExpired ? 1 : existing.count + 1
  if (count > input.limit) {
    throw new AuthFailure('registration_limited', 'Registration limit reached. Try again later.')
  }
  const windowStartedAt = windowExpired ? input.now : existing.windowStartedAt
  await tx.authAbuseBucket.upsert({
    where: { scope_keyHash: { scope: input.scope, keyHash: input.keyHash } },
    create: {
      count,
      expiresAt: new Date(windowStartedAt.getTime() + input.windowMs),
      keyHash: input.keyHash,
      scope: input.scope,
      windowStartedAt,
    },
    update: {
      blockedUntil: null,
      count,
      expiresAt: new Date(windowStartedAt.getTime() + input.windowMs),
      windowStartedAt,
    },
  })
}

function hashRegistrationKey(secret: string, scope: string, value: string) {
  return createHmac('sha256', secret)
    .update(`auth-registration:${scope}:${value}`)
    .digest('hex')
}

function isRetryableTransactionError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 'P2034'
      || (error.code === 'P2002'
        && 'meta' in error
        && typeof error.meta === 'object'
        && error.meta !== null
        && 'modelName' in error.meta
        && error.meta.modelName === 'AuthAbuseBucket'))
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
