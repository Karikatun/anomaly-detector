import { createHmac, timingSafeEqual } from 'node:crypto'

import type { DbClient } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import {
  cancelQueuedTransactionalMail,
  createTransactionalMailRequester,
  deriveAccountEmailConfirmationCode,
  evaluateTransactionalAccountEmail,
} from '../../mail'
import type { AuthRepository } from '../application/ports'
import { AuthFailure } from '../domain/errors'

const registrationDeviceWindowMs = 180 * 24 * 60 * 60 * 1_000
const registrationIpWindowMs = 24 * 60 * 60 * 1_000
const minuteMs = 60 * 1_000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs

export function createPrismaAuthRepository(
  db: DbClient,
  abuseSecret: string,
  options: { createMessageId?: () => string } = {},
): AuthRepository {
  return {
    findUserById(userId) {
      return db.user.findUnique({ where: { id: userId } })
    },

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

    async completeOAuthSignIn(input) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            await lockAuthTransactionKey(
              tx,
              abuseSecret,
              'oauth-identity',
              `${input.identity.provider}\u0000${input.identity.subject}`,
            )

            const identity = await tx.authIdentity.findUnique({
              where: {
                provider_subject: {
                  provider: input.identity.provider,
                  subject: input.identity.subject,
                },
              },
              select: { userId: true },
            })
            const isNewIdentity = identity === null

            let user = identity
              ? await tx.user.findUniqueOrThrow({ where: { id: identity.userId } })
              : null
            if (!user) {
              if (!input.newUser) return null
              user = await tx.user.create({
                data: {
                  displayName: input.newUser.displayName ?? null,
                  login: input.newUser.login,
                  passwordHash: null,
                  privacyConsentAt: input.newUser.legalAcceptance.acceptedAt,
                  privacyConsentVersion: input.newUser.legalAcceptance.privacyConsentVersion,
                  termsAcceptedAt: input.newUser.legalAcceptance.acceptedAt,
                  termsVersion: input.newUser.legalAcceptance.termsVersion,
                },
              })
              await tx.authIdentity.create({
                data: {
                  provider: input.identity.provider,
                  subject: input.identity.subject,
                  userId: user.id,
                },
              })
            }

            const emailLockKeys = [
              user.accountEmailCanonicalKey,
              input.accountEmail.kind === 'candidate'
                ? input.accountEmail.canonicalKey
                : null,
            ].filter((value): value is string => value !== null)
              .filter((value, index, values) => values.indexOf(value) === index)
              .sort()
            for (const canonicalKey of emailLockKeys) {
              await lockAuthTransactionKey(
                tx,
                abuseSecret,
                'account-email',
                canonicalKey,
              )
            }

            if (input.accountEmail.kind === 'candidate') {
              const owner = await tx.user.findUnique({
                where: { accountEmailCanonicalKey: input.accountEmail.canonicalKey },
                select: { id: true },
              })
              const recoveryOwner = await tx.recoveryEmailBinding.findUnique({
                where: { canonicalKey: input.accountEmail.canonicalKey },
                select: { userId: true },
              })
              const occupiedByAnother = Boolean(
                (owner && owner.id !== user.id)
                || (recoveryOwner && recoveryOwner.userId !== user.id),
              )
              if (isNewIdentity && occupiedByAnother) {
                throw new AuthFailure(
                  'oauth_account_email_conflict',
                  'Unable to create this Yandex account',
                )
              }
              user = await tx.user.update({
                where: { id: user.id },
                data: occupiedByAnother
                  ? {
                      accountEmailCanonicalKey: null,
                      accountEmailProviderValue: null,
                      accountEmailState: 'yandex_conflict',
                    }
                  : {
                      accountEmailCanonicalKey: input.accountEmail.canonicalKey,
                      accountEmailProviderValue: input.accountEmail.providerValue,
                      accountEmailState: 'yandex_managed',
                    },
              })
            } else {
              user = await tx.user.update({
                where: { id: user.id },
                data: {
                  accountEmailCanonicalKey: null,
                  accountEmailProviderValue: null,
                  accountEmailState: 'yandex_unavailable',
                },
              })
            }

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
          throw error
        }
      }
      throw new Error('Unreachable OAuth completion transaction retry state')
    },

    async readAccountProtection(userId) {
      return db.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            accountEmailProviderValue: true,
            accountEmailState: true,
          },
        })
        if (!user) return null
        const recoveryEmailBinding = await tx.recoveryEmailBinding.findUnique({
          where: { userId },
          select: {
            activatesAt: true,
            cancellationSessionIds: true,
            providerValue: true,
            requestedAt: true,
          },
        })
        const recoveryEmailChallenge = await tx.recoveryEmailChallenge.findUnique({
          where: { userId },
          select: {
            cancellationSessionIds: true,
            expiresAt: true,
            providerValue: true,
            requestedAt: true,
          },
        })
        const recoveryEmailReplacement = await tx.recoveryEmailReplacement.findUnique({
          where: { userId },
          select: {
            newCanonicalKey: true,
            newConfirmedAt: true,
            newExpiresAt: true,
            newProviderValue: true,
            oldConfirmedAt: true,
            oldExpiresAt: true,
            oldProviderValue: true,
            requestingSessionId: true,
          },
        })
        const yandexIdentity = await tx.authIdentity.findFirst({
          where: { provider: 'yandex', userId },
          select: { id: true },
        })
        return {
          accountEmailProviderValue: user.accountEmailProviderValue,
          accountEmailState: user.accountEmailState,
          hasYandexIdentity: yandexIdentity !== null,
          recoveryEmailBinding,
          recoveryEmailChallenge,
          recoveryEmailReplacement,
        }
      })
    },

    async startRecoveryEmail(input) {
      const messageId = options.createMessageId?.() ?? crypto.randomUUID()
      const confirmationCode = deriveAccountEmailConfirmationCode(abuseSecret, messageId)
      const codeHash = hashRecoveryEmailCode(
        abuseSecret,
        input.userId,
        input.canonicalKey,
        confirmationCode,
      )
      const quotas = recoveryEmailQuotas(abuseSecret, input)

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await db.$transaction(async (tx) => {
            const locks = [
              { scope: 'recovery-user', value: input.userId },
              { scope: 'account-email', value: input.canonicalKey },
              ...quotas.map((quota) => ({
                scope: 'recovery-budget',
                value: `${quota.scope}:${quota.keyHash}`,
              })),
            ].sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const user = await tx.user.findUnique({
              where: { id: input.userId },
              select: { passwordHash: true },
            })
            if (!user?.passwordHash || user.passwordHash !== input.expectedPasswordHash) {
              throw new AuthFailure('recovery_password_invalid', 'Current password is invalid')
            }
            const yandexIdentity = await tx.authIdentity.findFirst({
              where: { provider: 'yandex', userId: input.userId },
              select: { id: true },
            })
            const recoveryEmailBinding = await tx.recoveryEmailBinding.findUnique({
              where: { userId: input.userId },
              select: { id: true },
            })
            if (yandexIdentity || recoveryEmailBinding) {
              throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
            }
            const recoveryEmailChallenge = await tx.recoveryEmailChallenge.findUnique({
              where: { userId: input.userId },
              select: { id: true },
            })
            if (recoveryEmailChallenge) {
              throw new AuthFailure('recovery_email_pending', 'Recovery Email confirmation is already pending')
            }
            const sessions = await tx.authSession.findMany({
              where: {
                createdAt: { lte: input.now },
                expiresAt: { gt: input.now },
                revokedAt: null,
                userId: input.userId,
              },
              select: { id: true },
            })
            const cancellationSessionIds = sessions
              .map((session) => session.id)
              .sort()
            if (!cancellationSessionIds.includes(input.sessionId)) {
              throw new AuthFailure('session_invalid', 'Session is invalid or expired')
            }

            const accountOwner = await tx.user.findUnique({
              where: { accountEmailCanonicalKey: input.canonicalKey },
              select: { id: true },
            })
            const recoveryOwner = await tx.recoveryEmailBinding.findUnique({
              where: { canonicalKey: input.canonicalKey },
              select: { userId: true },
            })
            if (
              (accountOwner && accountOwner.id !== input.userId)
              || (recoveryOwner && recoveryOwner.userId !== input.userId)
            ) {
              throw new AuthFailure('recovery_email_conflict', 'Recovery Email is unavailable')
            }

            for (const quota of quotas) {
              await consumeRecoveryEmailQuota(tx, { ...quota, now: input.now })
            }
            await tx.recoveryEmailChallenge.create({
              data: {
                attemptCount: 0,
                cancellationSessionIds,
                canonicalKey: input.canonicalKey,
                codeHash,
                expiresAt: input.expiresAt,
                messageId,
                policyVersion: input.policyVersion,
                providerValue: input.providerValue,
                requestedAt: input.now,
                userId: input.userId,
              },
            })
            await createTransactionalMailRequester(tx, abuseSecret).enqueue({
              messageId,
              recipient: input.providerValue,
              template: {
                addressRole: 'recovery',
                expiresAt: input.expiresAt,
                kind: 'account_email_confirmation',
              },
            })
          })
          return
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          throw error
        }
      }
    },

    async resendRecoveryEmail(input) {
      const snapshot = await db.recoveryEmailChallenge.findUnique({
        where: { userId: input.userId },
        select: { canonicalKey: true, id: true },
      })
      if (!snapshot) {
        throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
      }
      const messageId = options.createMessageId?.() ?? crypto.randomUUID()
      const confirmationCode = deriveAccountEmailConfirmationCode(abuseSecret, messageId)
      const codeHash = hashRecoveryEmailCode(
        abuseSecret,
        input.userId,
        snapshot.canonicalKey,
        confirmationCode,
      )
      const quotas = recoveryEmailQuotas(abuseSecret, {
        canonicalKey: snapshot.canonicalKey,
        ipAddress: input.ipAddress,
        userId: input.userId,
      })

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await db.$transaction(async (tx) => {
            const locks = [
              { scope: 'recovery-user', value: input.userId },
              { scope: 'account-email', value: snapshot.canonicalKey },
              ...quotas.map((quota) => ({
                scope: 'recovery-budget',
                value: `${quota.scope}:${quota.keyHash}`,
              })),
            ].sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const challenge = await tx.recoveryEmailChallenge.findUnique({
              where: { userId: input.userId },
            })
            if (!challenge || challenge.id !== snapshot.id) {
              throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
            }
            for (const quota of quotas) {
              await consumeRecoveryEmailQuota(tx, { ...quota, now: input.now })
            }
            await tx.recoveryEmailChallenge.update({
              where: { id: challenge.id },
              data: {
                attemptCount: 0,
                codeHash,
                expiresAt: input.expiresAt,
                messageId,
              },
            })
            await cancelQueuedTransactionalMail(tx, {
              messageId: challenge.messageId,
              now: input.now,
            })
            await createTransactionalMailRequester(tx, abuseSecret).enqueue({
              messageId,
              recipient: challenge.providerValue,
              template: {
                addressRole: 'recovery',
                expiresAt: input.expiresAt,
                kind: 'account_email_confirmation',
              },
            })
          })
          return
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          throw error
        }
      }
    },

    async confirmRecoveryEmail(input) {
      const snapshot = await db.recoveryEmailChallenge.findUnique({
        where: { userId: input.userId },
        select: { canonicalKey: true },
      })
      if (!snapshot) {
        return await db.recoveryEmailBinding.findUnique({ where: { userId: input.userId } })
          ? 'already_confirmed'
          : 'invalid'
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            const locks = [
              { scope: 'recovery-user', value: input.userId },
              { scope: 'account-email', value: snapshot.canonicalKey },
            ].sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const binding = await tx.recoveryEmailBinding.findUnique({
              where: { userId: input.userId },
              select: { id: true },
            })
            if (binding) return 'already_confirmed' as const

            const challenge = await tx.recoveryEmailChallenge.findUnique({
              where: { userId: input.userId },
            })
            if (
              !challenge
              || challenge.canonicalKey !== snapshot.canonicalKey
              || challenge.expiresAt <= input.now
              || challenge.attemptCount >= 5
            ) {
              return 'invalid' as const
            }

            const presentedHash = hashRecoveryEmailCode(
              abuseSecret,
              input.userId,
              challenge.canonicalKey,
              input.code,
            )
            if (!codeHashesEqual(challenge.codeHash, presentedHash)) {
              await tx.recoveryEmailChallenge.update({
                where: { id: challenge.id },
                data: { attemptCount: { increment: 1 } },
              })
              return 'invalid' as const
            }

            const accountOwner = await tx.user.findUnique({
              where: { accountEmailCanonicalKey: challenge.canonicalKey },
              select: { id: true },
            })
            const recoveryOwner = await tx.recoveryEmailBinding.findUnique({
              where: { canonicalKey: challenge.canonicalKey },
              select: { userId: true },
            })
            if (
              (accountOwner && accountOwner.id !== input.userId)
              || (recoveryOwner && recoveryOwner.userId !== input.userId)
            ) {
              throw new AuthFailure('recovery_email_conflict', 'Recovery Email is unavailable')
            }

            await tx.recoveryEmailBinding.create({
              data: {
                activatesAt: input.activatesAt,
                cancellationSessionIds: challenge.cancellationSessionIds,
                canonicalKey: challenge.canonicalKey,
                providerValue: challenge.providerValue,
                policyVersion: challenge.policyVersion,
                requestedAt: challenge.requestedAt,
                userId: input.userId,
              },
            })
            await cancelQueuedTransactionalMail(tx, {
              messageId: challenge.messageId,
              now: input.now,
            })
            await tx.recoveryEmailChallenge.delete({ where: { id: challenge.id } })
            return 'confirmed' as const
          })
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          if (isUniqueConstraintError(error)) {
            throw new AuthFailure('recovery_email_conflict', 'Recovery Email is unavailable')
          }
          throw error
        }
      }
      throw new Error('Unreachable Recovery Email confirmation retry state')
    },

    async cancelRecoveryEmail(input) {
      const challengeSnapshot = await db.recoveryEmailChallenge.findUnique({
        where: { userId: input.userId },
        select: { canonicalKey: true },
      })
      const bindingSnapshot = challengeSnapshot
        ? null
        : await db.recoveryEmailBinding.findUnique({
            where: { userId: input.userId },
            select: { activatesAt: true, canonicalKey: true },
          })
      if (!challengeSnapshot && (!bindingSnapshot || bindingSnapshot.activatesAt <= input.now)) {
        return 'unavailable'
      }
      const canonicalKey = challengeSnapshot?.canonicalKey ?? bindingSnapshot?.canonicalKey
      if (!canonicalKey) return 'unavailable'

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            const locks = [
              { scope: 'recovery-user', value: input.userId },
              { scope: 'account-email', value: canonicalKey },
            ].sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const binding = await tx.recoveryEmailBinding.findUnique({
              where: { userId: input.userId },
            })
            const challenge = binding
              ? null
              : await tx.recoveryEmailChallenge.findUnique({
                  where: { userId: input.userId },
                })
            if (binding?.activatesAt && binding.activatesAt <= input.now) return 'unavailable' as const
            const target = binding ?? challenge
            if (!target || target.canonicalKey !== canonicalKey) return 'unavailable' as const
            if (!target.cancellationSessionIds.includes(input.sessionId)) {
              return 'forbidden' as const
            }

            if (binding) {
              await tx.recoveryEmailBinding.delete({ where: { id: binding.id } })
            } else if (challenge) {
              await cancelQueuedTransactionalMail(tx, {
                messageId: challenge.messageId,
                now: input.now,
              })
              await tx.recoveryEmailChallenge.delete({ where: { id: challenge.id } })
            }
            await tx.authSession.updateMany({
              where: {
                id: { notIn: target.cancellationSessionIds },
                revokedAt: null,
                userId: input.userId,
              },
              data: { revokedAt: input.now },
            })
            return 'cancelled' as const
          })
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          throw error
        }
      }
      throw new Error('Unreachable Recovery Email cancellation retry state')
    },

    async startRecoveryEmailReplacement(input) {
      const bindingSnapshot = await db.recoveryEmailBinding.findUnique({
        where: { userId: input.userId },
        select: { canonicalKey: true, id: true },
      })
      if (!bindingSnapshot) {
        throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
      }
      const oldMessageId = options.createMessageId?.() ?? crypto.randomUUID()
      const newMessageId = options.createMessageId?.() ?? crypto.randomUUID()
      const oldCode = deriveAccountEmailConfirmationCode(abuseSecret, oldMessageId)
      const newCode = deriveAccountEmailConfirmationCode(abuseSecret, newMessageId)
      const oldCodeHash = hashRecoveryEmailCode(
        abuseSecret,
        input.userId,
        bindingSnapshot.canonicalKey,
        oldCode,
      )
      const newCodeHash = hashRecoveryEmailCode(
        abuseSecret,
        input.userId,
        input.newCanonicalKey,
        newCode,
      )
      const quotas = recoveryEmailReplacementQuotas(abuseSecret, {
        ipAddress: input.ipAddress,
        newCanonicalKey: input.newCanonicalKey,
        oldCanonicalKey: bindingSnapshot.canonicalKey,
        userId: input.userId,
      })

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await db.$transaction(async (tx) => {
            const locks = [
              { scope: 'recovery-user', value: input.userId },
              { scope: 'account-email', value: bindingSnapshot.canonicalKey },
              { scope: 'account-email', value: input.newCanonicalKey },
              ...quotas.map((quota) => ({
                scope: 'recovery-budget',
                value: `${quota.scope}:${quota.keyHash}`,
              })),
            ].sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const user = await tx.user.findUnique({
              where: { id: input.userId },
              select: { passwordHash: true },
            })
            if (!user?.passwordHash || user.passwordHash !== input.expectedPasswordHash) {
              throw new AuthFailure('recovery_password_invalid', 'Current password is invalid')
            }
            const session = await tx.authSession.findFirst({
              where: {
                expiresAt: { gt: input.now },
                id: input.sessionId,
                revokedAt: null,
                userId: input.userId,
              },
              select: { id: true },
            })
            if (!session) {
              throw new AuthFailure('session_invalid', 'Session is invalid or expired')
            }
            const yandexIdentity = await tx.authIdentity.findFirst({
              where: { provider: 'yandex', userId: input.userId },
              select: { id: true },
            })
            const binding = await tx.recoveryEmailBinding.findUnique({
              where: { userId: input.userId },
            })
            if (
              yandexIdentity
              || !binding
              || binding.id !== bindingSnapshot.id
              || binding.canonicalKey !== bindingSnapshot.canonicalKey
              || binding.activatesAt > input.now
              || binding.canonicalKey === input.newCanonicalKey
            ) {
              throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
            }
            await requireRecoveryEmailPolicy(tx, {
              canonicalKey: binding.canonicalKey,
              providerValue: binding.providerValue,
              requirement: 'delivery',
            })
            const newAddressPolicy = await requireRecoveryEmailPolicy(tx, {
              canonicalKey: input.newCanonicalKey,
              providerValue: input.newProviderValue,
              requirement: 'new_address',
            })
            if (await tx.recoveryEmailReplacement.findUnique({
              where: { userId: input.userId },
              select: { id: true },
            })) {
              throw new AuthFailure(
                'recovery_email_pending',
                'Recovery Email replacement is already pending',
              )
            }

            const accountOwner = await tx.user.findUnique({
              where: { accountEmailCanonicalKey: input.newCanonicalKey },
              select: { id: true },
            })
            const recoveryOwner = await tx.recoveryEmailBinding.findUnique({
              where: { canonicalKey: input.newCanonicalKey },
              select: { userId: true },
            })
            if (
              (accountOwner && accountOwner.id !== input.userId)
              || (recoveryOwner && recoveryOwner.userId !== input.userId)
            ) {
              throw new AuthFailure('recovery_email_conflict', 'Recovery Email is unavailable')
            }

            for (const quota of quotas) {
              await consumeRecoveryEmailQuota(tx, { ...quota, now: input.now })
            }
            await tx.recoveryEmailReplacement.create({
              data: {
                newAttemptCount: 0,
                newCanonicalKey: input.newCanonicalKey,
                newCodeHash,
                newExpiresAt: input.expiresAt,
                newMessageId,
                newPolicyVersion: newAddressPolicy.policyVersion,
                newProviderValue: newAddressPolicy.providerValue,
                oldAttemptCount: 0,
                oldCanonicalKey: binding.canonicalKey,
                oldCodeHash,
                oldExpiresAt: input.expiresAt,
                oldMessageId,
                oldProviderValue: binding.providerValue,
                requestedAt: input.now,
                requestingSessionId: input.sessionId,
                userId: input.userId,
              },
            })
            const mail = createTransactionalMailRequester(tx, abuseSecret)
            await mail.enqueue({
              messageId: oldMessageId,
              recipient: binding.providerValue,
              template: {
                addressRole: 'recovery',
                expiresAt: input.expiresAt,
                kind: 'account_email_confirmation',
                recoveryPurpose: 'replacement_old',
              },
            })
            await mail.enqueue({
              messageId: newMessageId,
              recipient: newAddressPolicy.providerValue,
              template: {
                addressRole: 'recovery',
                expiresAt: input.expiresAt,
                kind: 'account_email_confirmation',
                recoveryPurpose: 'replacement_new',
              },
            })
          })
          return
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          if (isUniqueConstraintError(error)) {
            throw new AuthFailure('recovery_email_conflict', 'Recovery Email is unavailable')
          }
          throw error
        }
      }
    },

    async resendRecoveryEmailReplacement(input) {
      const snapshot = await db.recoveryEmailReplacement.findUnique({
        where: { userId: input.userId },
      })
      if (!snapshot) {
        throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
      }
      const canonicalKey = input.factor === 'old'
        ? snapshot.oldCanonicalKey
        : snapshot.newCanonicalKey
      const messageId = options.createMessageId?.() ?? crypto.randomUUID()
      const code = deriveAccountEmailConfirmationCode(abuseSecret, messageId)
      const codeHash = hashRecoveryEmailCode(abuseSecret, input.userId, canonicalKey, code)
      const quotas = recoveryEmailQuotas(abuseSecret, {
        canonicalKey,
        ipAddress: input.ipAddress,
        userId: input.userId,
      })

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await db.$transaction(async (tx) => {
            const locks = [
              { scope: 'recovery-user', value: input.userId },
              { scope: 'account-email', value: canonicalKey },
              ...quotas.map((quota) => ({
                scope: 'recovery-budget',
                value: `${quota.scope}:${quota.keyHash}`,
              })),
            ].sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const replacement = await tx.recoveryEmailReplacement.findUnique({
              where: { userId: input.userId },
            })
            const binding = await tx.recoveryEmailBinding.findUnique({
              where: { userId: input.userId },
              select: { activatesAt: true, canonicalKey: true, providerValue: true },
            })
            const session = await tx.authSession.findFirst({
              where: {
                expiresAt: { gt: input.now },
                id: input.sessionId,
                revokedAt: null,
                userId: input.userId,
              },
              select: { id: true },
            })
            if (
              !replacement
              || replacement.id !== snapshot.id
              || replacement.requestingSessionId !== input.sessionId
              || !binding
              || binding.canonicalKey !== replacement.oldCanonicalKey
              || binding.providerValue !== replacement.oldProviderValue
              || binding.activatesAt > input.now
              || !session
            ) {
              throw new AuthFailure(
                'recovery_replacement_forbidden',
                'This session cannot change the pending Recovery Email replacement',
              )
            }
            await requireRecoveryEmailPolicy(tx, {
              canonicalKey,
              providerValue: input.factor === 'old'
                ? replacement.oldProviderValue
                : replacement.newProviderValue,
              requirement: input.factor === 'old' ? 'delivery' : 'new_address',
            })
            const confirmedAt = input.factor === 'old'
              ? replacement.oldConfirmedAt
              : replacement.newConfirmedAt
            const expiresAt = input.factor === 'old'
              ? replacement.oldExpiresAt
              : replacement.newExpiresAt
            if (confirmedAt && expiresAt > input.now) {
              throw new AuthFailure(
                'recovery_email_pending',
                'This Recovery Email factor is already confirmed',
              )
            }
            for (const quota of quotas) {
              await consumeRecoveryEmailQuota(tx, { ...quota, now: input.now })
            }

            const previousMessageId = input.factor === 'old'
              ? replacement.oldMessageId
              : replacement.newMessageId
            if (input.factor === 'old') {
              await tx.recoveryEmailReplacement.update({
                where: { id: replacement.id },
                data: {
                  oldAttemptCount: 0,
                  oldCodeHash: codeHash,
                  oldConfirmedAt: null,
                  oldExpiresAt: input.expiresAt,
                  oldMessageId: messageId,
                },
              })
            } else {
              await tx.recoveryEmailReplacement.update({
                where: { id: replacement.id },
                data: {
                  newAttemptCount: 0,
                  newCodeHash: codeHash,
                  newConfirmedAt: null,
                  newExpiresAt: input.expiresAt,
                  newMessageId: messageId,
                },
              })
            }
            await cancelQueuedTransactionalMail(tx, {
              messageId: previousMessageId,
              now: input.now,
            })
            await createTransactionalMailRequester(tx, abuseSecret).enqueue({
              messageId,
              recipient: input.factor === 'old'
                ? replacement.oldProviderValue
                : replacement.newProviderValue,
              template: {
                addressRole: 'recovery',
                expiresAt: input.expiresAt,
                kind: 'account_email_confirmation',
                recoveryPurpose: input.factor === 'old'
                  ? 'replacement_old'
                  : 'replacement_new',
              },
            })
          })
          return
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          throw error
        }
      }
    },

    async confirmRecoveryEmailReplacement(input) {
      const snapshot = await db.recoveryEmailReplacement.findUnique({
        where: { userId: input.userId },
        select: { id: true, newCanonicalKey: true, oldCanonicalKey: true },
      })
      if (!snapshot) return 'invalid'
      const notificationMessageId = options.createMessageId?.() ?? crypto.randomUUID()

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            const locks = [
              { scope: 'recovery-user', value: input.userId },
              { scope: 'account-email', value: snapshot.oldCanonicalKey },
              { scope: 'account-email', value: snapshot.newCanonicalKey },
            ].sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const replacement = await tx.recoveryEmailReplacement.findUnique({
              where: { userId: input.userId },
            })
            const session = await tx.authSession.findFirst({
              where: {
                expiresAt: { gt: input.now },
                id: input.sessionId,
                revokedAt: null,
                userId: input.userId,
              },
              select: { id: true },
            })
            if (
              !replacement
              || replacement.id !== snapshot.id
              || replacement.requestingSessionId !== input.sessionId
              || !session
            ) {
              throw new AuthFailure(
                'recovery_replacement_forbidden',
                'This session cannot confirm the pending Recovery Email replacement',
              )
            }
            await requireRecoveryEmailPolicy(tx, {
              canonicalKey: replacement.oldCanonicalKey,
              providerValue: replacement.oldProviderValue,
              requirement: 'delivery',
            })
            const newAddressPolicy = await requireRecoveryEmailPolicy(tx, {
              canonicalKey: replacement.newCanonicalKey,
              providerValue: replacement.newProviderValue,
              requirement: 'new_address',
            })
            const canonicalKey = input.factor === 'old'
              ? replacement.oldCanonicalKey
              : replacement.newCanonicalKey
            const codeHash = input.factor === 'old'
              ? replacement.oldCodeHash
              : replacement.newCodeHash
            const confirmedAt = input.factor === 'old'
              ? replacement.oldConfirmedAt
              : replacement.newConfirmedAt
            const expiresAt = input.factor === 'old'
              ? replacement.oldExpiresAt
              : replacement.newExpiresAt
            const attemptCount = input.factor === 'old'
              ? replacement.oldAttemptCount
              : replacement.newAttemptCount
            if (confirmedAt || expiresAt <= input.now || attemptCount >= 5) return 'invalid' as const

            const presentedHash = hashRecoveryEmailCode(
              abuseSecret,
              input.userId,
              canonicalKey,
              input.code,
            )
            if (!codeHashesEqual(codeHash, presentedHash)) {
              if (input.factor === 'old') {
                await tx.recoveryEmailReplacement.update({
                  where: { id: replacement.id },
                  data: { oldAttemptCount: { increment: 1 } },
                })
              } else {
                await tx.recoveryEmailReplacement.update({
                  where: { id: replacement.id },
                  data: { newAttemptCount: { increment: 1 } },
                })
              }
              return 'invalid' as const
            }

            if (input.factor === 'old') {
              await tx.recoveryEmailReplacement.update({
                where: { id: replacement.id },
                data: { oldConfirmedAt: input.now },
              })
            } else {
              await tx.recoveryEmailReplacement.update({
                where: { id: replacement.id },
                data: { newConfirmedAt: input.now },
              })
            }
            await cancelQueuedTransactionalMail(tx, {
              messageId: input.factor === 'old'
                ? replacement.oldMessageId
                : replacement.newMessageId,
              now: input.now,
            })
            const otherConfirmedAt = input.factor === 'old'
              ? replacement.newConfirmedAt
              : replacement.oldConfirmedAt
            const otherExpiresAt = input.factor === 'old'
              ? replacement.newExpiresAt
              : replacement.oldExpiresAt
            if (!otherConfirmedAt || otherExpiresAt <= input.now) return 'confirmed' as const

            const binding = await tx.recoveryEmailBinding.findUnique({
              where: { userId: input.userId },
            })
            if (
              !binding
              || binding.canonicalKey !== replacement.oldCanonicalKey
              || binding.providerValue !== replacement.oldProviderValue
              || binding.activatesAt > input.now
            ) {
              throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
            }
            const accountOwner = await tx.user.findUnique({
              where: { accountEmailCanonicalKey: replacement.newCanonicalKey },
              select: { id: true },
            })
            const recoveryOwner = await tx.recoveryEmailBinding.findUnique({
              where: { canonicalKey: replacement.newCanonicalKey },
              select: { userId: true },
            })
            if (
              (accountOwner && accountOwner.id !== input.userId)
              || (recoveryOwner && recoveryOwner.userId !== input.userId)
            ) {
              throw new AuthFailure('recovery_email_conflict', 'Recovery Email is unavailable')
            }

            const outstandingChallenge = await tx.recoveryEmailChallenge.findUnique({
              where: { userId: input.userId },
              select: { id: true, messageId: true },
            })
            if (outstandingChallenge) {
              await cancelQueuedTransactionalMail(tx, {
                messageId: outstandingChallenge.messageId,
                now: input.now,
              })
              await tx.recoveryEmailChallenge.delete({ where: { id: outstandingChallenge.id } })
            }
            await tx.recoveryEmailBinding.update({
              where: { id: binding.id },
              data: {
                activatesAt: input.now,
                cancellationSessionIds: [],
                canonicalKey: replacement.newCanonicalKey,
                policyVersion: newAddressPolicy.policyVersion,
                providerValue: newAddressPolicy.providerValue,
                requestedAt: replacement.requestedAt,
              },
            })
            await cancelQueuedTransactionalMail(tx, {
              messageId: replacement.oldMessageId,
              now: input.now,
            })
            await cancelQueuedTransactionalMail(tx, {
              messageId: replacement.newMessageId,
              now: input.now,
            })
            await tx.recoveryEmailReplacement.delete({ where: { id: replacement.id } })
            await tx.authSession.updateMany({
              where: {
                id: { not: input.sessionId },
                revokedAt: null,
                userId: input.userId,
              },
              data: { revokedAt: input.now },
            })
            await createTransactionalMailRequester(tx, abuseSecret).enqueue({
              messageId: notificationMessageId,
              recipient: replacement.oldProviderValue,
              template: {
                event: 'recovery_email_changed',
                kind: 'security_notification',
                occurredAt: input.now,
              },
            })
            return 'completed' as const
          })
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          if (isUniqueConstraintError(error)) {
            throw new AuthFailure('recovery_email_conflict', 'Recovery Email is unavailable')
          }
          throw error
        }
      }
      throw new Error('Unreachable Recovery Email replacement confirmation retry state')
    },

    async cancelRecoveryEmailReplacement(input) {
      const snapshot = await db.recoveryEmailReplacement.findUnique({
        where: { userId: input.userId },
        select: { id: true, newCanonicalKey: true, oldCanonicalKey: true },
      })
      if (!snapshot) return 'unavailable'

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            const locks = [
              { scope: 'recovery-user', value: input.userId },
              { scope: 'account-email', value: snapshot.oldCanonicalKey },
              { scope: 'account-email', value: snapshot.newCanonicalKey },
            ].sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const replacement = await tx.recoveryEmailReplacement.findUnique({
              where: { userId: input.userId },
            })
            if (!replacement || replacement.id !== snapshot.id) return 'unavailable' as const
            const session = await tx.authSession.findFirst({
              where: {
                expiresAt: { gt: input.now },
                id: input.sessionId,
                revokedAt: null,
                userId: input.userId,
              },
              select: { id: true },
            })
            if (!session || replacement.requestingSessionId !== input.sessionId) {
              return 'forbidden' as const
            }

            await cancelQueuedTransactionalMail(tx, {
              messageId: replacement.oldMessageId,
              now: input.now,
            })
            await cancelQueuedTransactionalMail(tx, {
              messageId: replacement.newMessageId,
              now: input.now,
            })
            await tx.recoveryEmailReplacement.delete({ where: { id: replacement.id } })
            return 'cancelled' as const
          })
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          throw error
        }
      }
      throw new Error('Unreachable Recovery Email replacement cancellation retry state')
    },

    async eraseUserIdentity({ userId, now }) {
      await db.$transaction(async (tx) => {
        const recoveryEmailChallenge = await tx.recoveryEmailChallenge.findUnique({
          where: { userId },
          select: { messageId: true },
        })
        if (recoveryEmailChallenge) {
          await cancelQueuedTransactionalMail(tx, {
            messageId: recoveryEmailChallenge.messageId,
            now,
          })
        }
        const recoveryEmailReplacement = await tx.recoveryEmailReplacement.findUnique({
          where: { userId },
          select: { newMessageId: true, oldMessageId: true },
        })
        if (recoveryEmailReplacement) {
          await cancelQueuedTransactionalMail(tx, {
            messageId: recoveryEmailReplacement.oldMessageId,
            now,
          })
          await cancelQueuedTransactionalMail(tx, {
            messageId: recoveryEmailReplacement.newMessageId,
            now,
          })
        }
        await tx.recoveryEmailChallenge.deleteMany({ where: { userId } })
        await tx.recoveryEmailReplacement.deleteMany({ where: { userId } })
        await tx.recoveryEmailBinding.deleteMany({ where: { userId } })
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
            passwordHash: null,
            accountEmailCanonicalKey: null,
            accountEmailProviderValue: null,
            accountEmailState: 'absent',
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

async function requireRecoveryEmailPolicy(
  transaction: Prisma.TransactionClient,
  input: {
    canonicalKey: string
    providerValue: string
    requirement: 'delivery' | 'new_address'
  },
) {
  const policy = await evaluateTransactionalAccountEmail(transaction, input.providerValue)
  const allowed = input.requirement === 'new_address'
    ? policy?.acceptsNewAddress
    : policy?.allowsRecoveryDelivery
  if (!policy || policy.canonicalKey !== input.canonicalKey || !allowed) {
    throw new AuthFailure('recovery_email_unavailable', 'Recovery Email is unavailable')
  }
  return policy
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

function recoveryEmailQuotas(
  secret: string,
  input: { canonicalKey: string; ipAddress?: string; userId: string },
) {
  const definitions = [
    ['rec_email_account_min', input.userId, 1, minuteMs],
    ['rec_email_account_hour', input.userId, 3, hourMs],
    ['rec_email_account_day', input.userId, 5, dayMs],
    ['rec_email_address_min', input.canonicalKey, 1, minuteMs],
    ['rec_email_address_hour', input.canonicalKey, 3, hourMs],
    ['rec_email_address_day', input.canonicalKey, 5, dayMs],
    ['rec_email_ip_hour', input.ipAddress ?? 'unknown', 20, hourMs],
  ] as const
  return definitions.map(([scope, value, limit, windowMs]) => ({
    keyHash: hashRecoveryBudgetKey(secret, scope, value),
    limit,
    scope,
    windowMs,
  }))
}

function recoveryEmailReplacementQuotas(
  secret: string,
  input: {
    ipAddress?: string
    newCanonicalKey: string
    oldCanonicalKey: string
    userId: string
  },
) {
  const definitions = [
    ['rec_email_account_min', input.userId, 1, minuteMs],
    ['rec_email_account_hour', input.userId, 3, hourMs],
    ['rec_email_account_day', input.userId, 5, dayMs],
    ['rec_email_address_min', input.oldCanonicalKey, 1, minuteMs],
    ['rec_email_address_hour', input.oldCanonicalKey, 3, hourMs],
    ['rec_email_address_day', input.oldCanonicalKey, 5, dayMs],
    ['rec_email_address_min', input.newCanonicalKey, 1, minuteMs],
    ['rec_email_address_hour', input.newCanonicalKey, 3, hourMs],
    ['rec_email_address_day', input.newCanonicalKey, 5, dayMs],
    ['rec_email_ip_hour', input.ipAddress ?? 'unknown', 20, hourMs],
  ] as const
  return definitions.map(([scope, value, limit, windowMs]) => ({
    keyHash: hashRecoveryBudgetKey(secret, scope, value),
    limit,
    scope,
    windowMs,
  }))
}

async function consumeRecoveryEmailQuota(
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
    throw new AuthFailure(
      'recovery_email_limited',
      'Recovery Email request is temporarily unavailable',
    )
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

function hashRecoveryBudgetKey(secret: string, scope: string, value: string) {
  return createHmac('sha256', secret)
    .update('recovery-email-budget-v1\0')
    .update(scope)
    .update('\0')
    .update(value)
    .digest('hex')
}

function hashRecoveryEmailCode(
  secret: string,
  userId: string,
  canonicalKey: string,
  code: string,
) {
  return createHmac('sha256', secret)
    .update('recovery-email-verification-v1\0')
    .update(userId)
    .update('\0')
    .update(canonicalKey)
    .update('\0')
    .update(code)
    .digest('hex')
}

function codeHashesEqual(storedHash: string, presentedHash: string) {
  const stored = Buffer.from(storedHash, 'hex')
  const presented = Buffer.from(presentedHash, 'hex')
  return stored.length === presented.length && timingSafeEqual(stored, presented)
}

function hashRegistrationKey(secret: string, scope: string, value: string) {
  return createHmac('sha256', secret)
    .update(`auth-registration:${scope}:${value}`)
    .digest('hex')
}

async function lockAuthTransactionKey(
  tx: Prisma.TransactionClient,
  secret: string,
  scope: string,
  value: string,
) {
  const key = createHmac('sha256', secret)
    .update(`auth-transaction:${scope}:${value}`)
    .digest('hex')
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lock"`
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
