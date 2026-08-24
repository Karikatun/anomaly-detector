import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  isRetryableDatabaseTransactionConflict,
  type DbClient,
} from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import {
  cancelQueuedTransactionalMail,
  createTransactionalMailRequester,
  deriveAccountEmailConfirmationCode,
  derivePasswordResetToken,
  evaluateTransactionalAccountEmail,
} from '../../mail'
import type { AuthRepository } from '../application/ports'
import { AuthFailure } from '../domain/errors'
import {
  createRequestBudgetPolicyCatalog,
  type RequestBudgetPolicyCatalog,
} from '../../../security/request-budget-policy'

export function createPrismaAuthRepository(
  db: DbClient,
  abuseSecret: string,
  options: {
    createMessageId?: () => string
    requestBudgetPolicies?: RequestBudgetPolicyCatalog
  } = {},
): AuthRepository {
  const requestBudgetPolicies = options.requestBudgetPolicies
    ?? createRequestBudgetPolicyCatalog()
  return {
    findUserById(userId) {
      return db.user.findUnique({ where: { id: userId } })
    },

    findUserByLogin(login) {
      return db.user.findUnique({ where: { login } })
    },

    async updatePasswordHash({ userId, currentPasswordHash, nextPasswordHash }) {
      return db.$transaction(async (tx) => {
        await lockAuthTransactionKey(tx, abuseSecret, 'recovery-user', userId)
        const result = await tx.user.updateMany({
          where: { id: userId, passwordHash: currentPasswordHash },
          data: { passwordHash: nextPasswordHash },
        })
        return result.count === 1
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
                  limit: requestBudgetPolicies.registration_device.limit,
                  now: input.registration.now,
                  scope: 'registration_device',
                  windowMs: requestBudgetPolicies.registration_device.windowMs,
                })
              }
              await consumeRegistrationQuota(tx, {
                keyHash: quotaKeys.find((quota) => quota.scope === 'registration_ip')!.keyHash,
                limit: requestBudgetPolicies.registration_ip.limit,
                now: input.registration.now,
                scope: 'registration_ip',
                windowMs: requestBudgetPolicies.registration_ip.windowMs,
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
      return db.$transaction(async (tx) => {
        await lockAuthTransactionKey(tx, abuseSecret, 'recovery-user', input.userId)
        const credential = await tx.user.findUnique({
          where: { id: input.userId },
          select: { passwordHash: true },
        })
        if (credential?.passwordHash !== input.expectedPasswordHash) {
          throw new AuthFailure('invalid_credentials', 'Invalid login or password')
        }
        return tx.authSession.create({
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
            return { created: isNewIdentity, user, session }
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
        const recoveryCodeSet = await tx.recoveryCodeSet.findUnique({
          where: { userId },
          select: { consumedAt: true },
        })
        const activeCodeCount = recoveryCodeSet
          ? await tx.recoveryCode.count({ where: { userId } })
          : 0
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
          recoveryCodeSet: recoveryCodeSet
            ? { activeCodeCount, consumedAt: recoveryCodeSet.consumedAt }
            : null,
        }
      })
    },

    async issueRecoveryCodes(input) {
      if (input.codes.length !== 8 || new Set(input.codes).size !== 8) {
        throw new AuthFailure('recovery_codes_unavailable', 'Recovery Codes are unavailable')
      }
      return db.$transaction(async (tx) => {
        await lockAuthTransactionKey(tx, abuseSecret, 'recovery-user', input.userId)
        const [user, binding, existingSet, yandexIdentity, replacement, codeReplacement] =
          await Promise.all([
            tx.user.findUnique({
              where: { id: input.userId },
              select: { passwordHash: true },
            }),
            tx.recoveryEmailBinding.findUnique({ where: { userId: input.userId } }),
            tx.recoveryCodeSet.findUnique({ where: { userId: input.userId } }),
            tx.authIdentity.findFirst({
              where: { provider: 'yandex', userId: input.userId },
              select: { id: true },
            }),
            tx.recoveryEmailReplacement.findUnique({
              where: { userId: input.userId },
              select: { id: true },
            }),
            tx.recoveryCodeEmailReplacement.findUnique({
              where: { userId: input.userId },
              select: { id: true },
            }),
          ])
        if (
          !user?.passwordHash
          || !binding
          || binding.activatesAt > input.now
          || existingSet
          || yandexIdentity
          || replacement
          || codeReplacement
        ) {
          return 'unavailable' as const
        }

        await tx.recoveryCodeSet.create({
          data: { issuedAt: input.now, userId: input.userId },
        })
        await tx.recoveryCode.createMany({
          data: input.codes.map((code) => ({
            codeHash: hashRecoveryCode(abuseSecret, input.userId, code),
            userId: input.userId,
          })),
        })
        return 'issued' as const
      })
    },

    async startRecoveryCodeReissue(input) {
      const bindingSnapshot = await db.recoveryEmailBinding.findUnique({
        where: { userId: input.userId },
      })
      if (!bindingSnapshot) return null
      const messageId = options.createMessageId?.() ?? crypto.randomUUID()
      const confirmationCode = deriveAccountEmailConfirmationCode(abuseSecret, messageId)
      const codeHash = hashRecoveryEmailCode(
        abuseSecret,
        input.userId,
        bindingSnapshot.canonicalKey,
        confirmationCode,
      )
      const quotas = recoveryEmailQuotas(abuseSecret, requestBudgetPolicies, {
        canonicalKey: bindingSnapshot.canonicalKey,
        ipAddress: input.ipAddress,
        userId: input.userId,
      })

      return runRetryableAuthTransaction(db, async (tx) => {
        const locks = [
          { scope: 'recovery-user', value: input.userId },
          { scope: 'account-email', value: bindingSnapshot.canonicalKey },
          ...quotas.map((quota) => ({
            scope: 'recovery-budget',
            value: `${quota.scope}:${quota.keyHash}`,
          })),
        ].sort((left, right) =>
          `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
        for (const lock of locks) {
          await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
        }

        const [user, binding, session, yandexIdentity, replacement, codeReplacement] =
          await Promise.all([
            tx.user.findUnique({
              where: { id: input.userId },
              select: { passwordHash: true },
            }),
            tx.recoveryEmailBinding.findUnique({ where: { userId: input.userId } }),
            tx.authSession.findFirst({
              where: {
                expiresAt: { gt: input.now },
                id: input.sessionId,
                revokedAt: null,
                userId: input.userId,
              },
              select: { id: true },
            }),
            tx.authIdentity.findFirst({
              where: { provider: 'yandex', userId: input.userId },
              select: { id: true },
            }),
            tx.recoveryEmailReplacement.findUnique({
              where: { userId: input.userId },
              select: { id: true },
            }),
            tx.recoveryCodeEmailReplacement.findUnique({
              where: { userId: input.userId },
              select: { id: true },
            }),
          ])
        if (!user?.passwordHash || user.passwordHash !== input.expectedPasswordHash) {
          throw new AuthFailure('recovery_password_invalid', 'Current password is invalid')
        }
        if (
          !binding
          || binding.id !== bindingSnapshot.id
          || binding.activatesAt > input.now
          || !session
          || yandexIdentity
          || replacement
          || codeReplacement
        ) {
          return null
        }
        await requireRecoveryEmailPolicy(tx, {
          canonicalKey: binding.canonicalKey,
          providerValue: binding.providerValue,
          requirement: 'delivery',
        })
        for (const quota of quotas) {
          await consumeRecoveryEmailQuota(tx, { ...quota, now: input.now })
        }
        const previous = await tx.recoveryCodeReissueChallenge.findUnique({
          where: { userId: input.userId },
        })
        if (previous) {
          await cancelQueuedTransactionalMail(tx, {
            messageId: previous.messageId,
            now: input.now,
          })
          await tx.recoveryCodeReissueChallenge.delete({ where: { id: previous.id } })
        }
        await tx.recoveryCodeReissueChallenge.create({
          data: {
            attemptCount: 0,
            codeHash,
            expiresAt: input.expiresAt,
            messageId,
            recoveryCanonicalKey: binding.canonicalKey,
            requestedAt: input.now,
            requestingSessionId: input.sessionId,
            userId: input.userId,
          },
        })
        await createTransactionalMailRequester(tx, abuseSecret).enqueue({
          messageId,
          recipient: binding.providerValue,
          template: {
            addressRole: 'recovery',
            expiresAt: input.expiresAt,
            kind: 'account_email_confirmation',
          },
        })
        return { expiresAt: input.expiresAt, providerValue: binding.providerValue }
      })
    },

    async confirmRecoveryCodeReissue(input) {
      if (input.codes.length !== 8 || new Set(input.codes).size !== 8) return 'unavailable'
      const snapshot = await db.recoveryCodeReissueChallenge.findUnique({
        where: { userId: input.userId },
      })
      if (!snapshot) return 'unavailable'

      return runRetryableAuthTransaction(db, async (tx) => {
        const locks = [
          { scope: 'recovery-user', value: input.userId },
          { scope: 'account-email', value: snapshot.recoveryCanonicalKey },
        ].sort((left, right) =>
          `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
        for (const lock of locks) {
          await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
        }
        const challenge = await tx.recoveryCodeReissueChallenge.findUnique({
          where: { userId: input.userId },
        })
        const binding = await tx.recoveryEmailBinding.findUnique({
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
          !challenge
          || challenge.id !== snapshot.id
          || !binding
          || binding.canonicalKey !== challenge.recoveryCanonicalKey
          || binding.activatesAt > input.now
          || challenge.requestingSessionId !== input.sessionId
          || !session
          || challenge.expiresAt <= input.now
          || challenge.attemptCount >= 5
        ) {
          return 'unavailable' as const
        }
        await requireRecoveryEmailPolicy(tx, {
          canonicalKey: binding.canonicalKey,
          providerValue: binding.providerValue,
          requirement: 'delivery',
        })
        const presentedHash = hashRecoveryEmailCode(
          abuseSecret,
          input.userId,
          challenge.recoveryCanonicalKey,
          input.code,
        )
        if (!codeHashesEqual(challenge.codeHash, presentedHash)) {
          await tx.recoveryCodeReissueChallenge.update({
            where: { id: challenge.id },
            data: { attemptCount: { increment: 1 } },
          })
          return 'invalid' as const
        }

        await replaceRecoveryCodeSet(tx, abuseSecret, input)
        await cancelQueuedTransactionalMail(tx, {
          messageId: challenge.messageId,
          now: input.now,
        })
        await tx.recoveryCodeReissueChallenge.delete({ where: { id: challenge.id } })
        return 'issued' as const
      })
    },

    async reserveRecoveryCodeUseBudget(input) {
      const quotas = recoveryCodeUseQuotas(abuseSecret, requestBudgetPolicies, input)
      return db.$transaction((tx) => consumeRecoveryRequestQuotasIpFirst(
        tx,
        abuseSecret,
        quotas,
        input.now,
      ))
    },

    async recoverPasswordWithRecoveryCode(input) {
      const snapshot = await db.user.findUnique({
        where: { login: input.login },
        select: { id: true },
      })
      return runRetryableAuthTransaction(db, async (tx) => {
        const locks = snapshot
          ? [{ scope: 'recovery-user', value: snapshot.id }]
          : []
        for (const lock of locks) {
          await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
        }
        const user = await tx.user.findUnique({
          where: { login: input.login },
          select: { id: true, passwordHash: true },
        })
        if (!snapshot || !user?.passwordHash || user.id !== snapshot.id) {
          performDummyRecoveryCodeComparison(abuseSecret, input.login, input.recoveryCode)
          return false
        }
        const [binding, yandexIdentity] = await Promise.all([
          tx.recoveryEmailBinding.findUnique({ where: { userId: user.id } }),
          tx.authIdentity.findFirst({
            where: { provider: 'yandex', userId: user.id },
            select: { id: true },
          }),
        ])
        if (!binding || binding.activatesAt > input.now || yandexIdentity) {
          performDummyRecoveryCodeComparison(abuseSecret, user.id, input.recoveryCode)
          return false
        }
        if (!await recoveryCodeMatches(tx, abuseSecret, user.id, input.recoveryCode)) return false

        await cancelOutstandingRecoveryCredentials(tx, user.id, input.now)
        await consumeRecoveryCodeSet(tx, user.id, input.now)
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: input.newPasswordHash },
        })
        await tx.authSession.updateMany({
          where: { revokedAt: null, userId: user.id },
          data: { revokedAt: input.now },
        })
        return true
      })
    },

    async requestPasswordReset(input) {
      const snapshot = await db.user.findUnique({
        where: { login: input.login },
        select: { id: true },
      })
      const messageId = options.createMessageId?.() ?? crypto.randomUUID()
      const token = derivePasswordResetToken(abuseSecret, messageId)
      const tokenHash = hashPasswordResetToken(abuseSecret, token)
      const quotas = passwordResetRequestQuotas(abuseSecret, requestBudgetPolicies, input)

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await db.$transaction(async (tx) => {
            const locks = (snapshot
              ? [{ scope: 'recovery-user', value: snapshot.id }]
              : []).sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const budgetAvailable = await consumeRecoveryRequestQuotasIpFirst(
              tx,
              abuseSecret,
              quotas,
              input.now,
            )
            const user = await tx.user.findUnique({
              where: { login: input.login },
              select: {
                id: true,
                passwordHash: true,
                recoveryEmailBinding: true,
                identities: {
                  where: { provider: 'yandex' },
                  select: { id: true },
                  take: 1,
                },
              },
            })
            const binding = user?.recoveryEmailBinding
            const policyProbe = binding ?? {
              canonicalKey: 'password-reset-probe@invalid.example',
              providerValue: 'password-reset-probe@invalid.example',
            }
            let policyAvailable = true
            try {
              await requireRecoveryEmailPolicy(tx, {
                ...policyProbe,
                requirement: 'delivery',
              })
            } catch (error) {
              if (!(error instanceof AuthFailure)) throw error
              policyAvailable = false
            }
            const previous = await tx.passwordResetCredential.findUnique({
              where: { userId: user?.id ?? '00000000-0000-0000-0000-000000000000' },
            })
            const eligible = Boolean(
              budgetAvailable
              && snapshot
              && user?.id === snapshot.id
              && user.passwordHash
              && binding
              && binding.activatesAt <= input.now
              && user.identities.length === 0
              && policyAvailable,
            )
            if (!eligible || !user || !binding) {
              // Preserve a comparable policy/read path for every public result without
              // creating a credential or outbox side effect for an ineligible account.
              await Promise.all([
                tx.passwordResetCredential.findUnique({
                  where: { tokenHash },
                  select: { id: true },
                }),
                tx.mailOutboxMessage.findUnique({
                  where: { messageId },
                  select: { id: true },
                }),
              ])
              codeHashesEqual('0'.repeat(64), tokenHash)
              return
            }

            if (previous) {
              await cancelQueuedTransactionalMail(tx, {
                messageId: previous.messageId,
                now: input.now,
              })
              await tx.passwordResetCredential.delete({ where: { id: previous.id } })
            }
            await tx.passwordResetCredential.create({
              data: {
                expiresAt: input.expiresAt,
                messageId,
                recoveryCanonicalKey: binding.canonicalKey,
                requestedAt: input.now,
                tokenHash,
                userId: user.id,
              },
            })
            await createTransactionalMailRequester(tx, abuseSecret).enqueue({
              messageId,
              recipient: binding.providerValue,
              template: {
                expiresAt: input.expiresAt,
                kind: 'password_recovery',
                recoveryUrl: input.recoveryUrl,
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

    async completePasswordReset(input) {
      const tokenHash = hashPasswordResetToken(abuseSecret, input.token)
      const snapshot = await db.passwordResetCredential.findUnique({
        where: { tokenHash },
        select: { id: true, recoveryCanonicalKey: true, userId: true },
      })
      if (!snapshot) {
        codeHashesEqual('0'.repeat(64), tokenHash)
        return false
      }
      const notificationMessageId = options.createMessageId?.() ?? crypto.randomUUID()

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            const locks = [
              { scope: 'recovery-user', value: snapshot.userId },
              { scope: 'account-email', value: snapshot.recoveryCanonicalKey },
            ].sort((left, right) =>
              `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
            for (const lock of locks) {
              await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
            }

            const credential = await tx.passwordResetCredential.findUnique({
              where: { tokenHash },
            })
            if (!credential || credential.id !== snapshot.id) return false
            const [user, binding, yandexIdentity] = await Promise.all([
              tx.user.findUnique({
                where: { id: credential.userId },
                select: { passwordHash: true },
              }),
              tx.recoveryEmailBinding.findUnique({ where: { userId: credential.userId } }),
              tx.authIdentity.findFirst({
                where: { provider: 'yandex', userId: credential.userId },
                select: { id: true },
              }),
            ])
            if (
              !user?.passwordHash
              || !binding
              || binding.activatesAt > input.now
              || binding.canonicalKey !== credential.recoveryCanonicalKey
              || credential.expiresAt <= input.now
              || yandexIdentity
            ) {
              await cancelQueuedTransactionalMail(tx, {
                messageId: credential.messageId,
                now: input.now,
              })
              await tx.passwordResetCredential.delete({ where: { id: credential.id } })
              return false
            }

            let notificationAllowed = false
            try {
              await requireRecoveryEmailPolicy(tx, {
                canonicalKey: binding.canonicalKey,
                providerValue: binding.providerValue,
                requirement: 'delivery',
              })
              notificationAllowed = true
            } catch (error) {
              if (!(error instanceof AuthFailure)) throw error
            }

            await cancelOutstandingRecoveryCredentials(tx, credential.userId, input.now)
            await consumeRecoveryCodeSet(tx, credential.userId, input.now)
            await tx.user.update({
              where: { id: credential.userId },
              data: { passwordHash: input.newPasswordHash },
            })
            await tx.authSession.updateMany({
              where: { revokedAt: null, userId: credential.userId },
              data: { revokedAt: input.now },
            })
            if (notificationAllowed) {
              await createTransactionalMailRequester(tx, abuseSecret).enqueue({
                messageId: notificationMessageId,
                recipient: binding.providerValue,
                template: {
                  event: 'password_changed',
                  kind: 'security_notification',
                  occurredAt: input.now,
                },
              })
            }
            return true
          })
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          throw error
        }
      }
      return false
    },

    async startRecoveryEmailWithRecoveryCode(input) {
      const snapshot = await db.user.findUnique({
        where: { login: input.login },
        select: {
          id: true,
          recoveryEmailBinding: {
            select: { canonicalKey: true, id: true },
          },
        },
      })
      const quotas = recoveryCodeUseQuotas(abuseSecret, requestBudgetPolicies, input)
      const messageId = options.createMessageId?.() ?? crypto.randomUUID()
      const confirmationCode = deriveAccountEmailConfirmationCode(abuseSecret, messageId)
      const newCodeHash = snapshot
        ? hashRecoveryEmailCode(
            abuseSecret,
            snapshot.id,
            input.newCanonicalKey,
            confirmationCode,
          )
        : createHmac('sha256', abuseSecret).update(confirmationCode).digest('hex')

      return runRetryableAuthTransaction(db, async (tx) => {
        const locks = [
          ...(snapshot ? [{ scope: 'recovery-user', value: snapshot.id }] : []),
          ...(snapshot?.recoveryEmailBinding
            ? [{ scope: 'account-email', value: snapshot.recoveryEmailBinding.canonicalKey }]
            : []),
          { scope: 'account-email', value: input.newCanonicalKey },
        ].sort((left, right) =>
          `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
        for (const lock of locks) {
          await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
        }
        const budgetAvailable = await consumeRecoveryRequestQuotasIpFirst(
          tx,
          abuseSecret,
          quotas,
          input.now,
        )
        const user = await tx.user.findUnique({
          where: { login: input.login },
          select: { id: true, passwordHash: true },
        })
        if (!budgetAvailable || !snapshot || !user?.passwordHash || user.id !== snapshot.id) {
          performDummyRecoveryCodeComparison(abuseSecret, input.login, input.recoveryCode)
          return null
        }
        const [binding, yandexIdentity] = await Promise.all([
          tx.recoveryEmailBinding.findUnique({ where: { userId: user.id } }),
          tx.authIdentity.findFirst({
            where: { provider: 'yandex', userId: user.id },
            select: { id: true },
          }),
        ])
        if (
          !binding
          || binding.activatesAt > input.now
          || yandexIdentity
          || binding.canonicalKey === input.newCanonicalKey
          || !await recoveryCodeMatches(tx, abuseSecret, user.id, input.recoveryCode)
        ) {
          return null
        }
        let policy
        try {
          policy = await requireRecoveryEmailPolicy(tx, {
            canonicalKey: input.newCanonicalKey,
            providerValue: input.newProviderValue,
            requirement: 'new_address',
          })
        } catch (error) {
          if (error instanceof AuthFailure) return null
          throw error
        }
        const [accountOwner, recoveryOwner] = await Promise.all([
          tx.user.findUnique({
            where: { accountEmailCanonicalKey: input.newCanonicalKey },
            select: { id: true },
          }),
          tx.recoveryEmailBinding.findUnique({
            where: { canonicalKey: input.newCanonicalKey },
            select: { userId: true },
          }),
        ])
        if (
          (accountOwner && accountOwner.id !== user.id)
          || (recoveryOwner && recoveryOwner.userId !== user.id)
        ) {
          return null
        }

        await cancelOutstandingRecoveryCredentials(tx, user.id, input.now)
        await consumeRecoveryCodeSet(tx, user.id, input.now)
        await tx.authSession.updateMany({
          where: { revokedAt: null, userId: user.id },
          data: { revokedAt: input.now },
        })
        await tx.recoveryCodeEmailReplacement.create({
          data: {
            newCanonicalKey: policy.canonicalKey,
            newCodeHash,
            newExpiresAt: input.expiresAt,
            newMessageId: messageId,
            newPolicyVersion: policy.policyVersion,
            newProviderValue: policy.providerValue,
            oldCanonicalKey: binding.canonicalKey,
            oldProviderValue: binding.providerValue,
            requestedAt: input.now,
            userId: user.id,
          },
        })
        await createTransactionalMailRequester(tx, abuseSecret).enqueue({
          messageId,
          recipient: policy.providerValue,
          template: {
            addressRole: 'recovery',
            expiresAt: input.expiresAt,
            kind: 'account_email_confirmation',
          },
        })
        return { expiresAt: input.expiresAt, providerValue: policy.providerValue }
      })
    },

    async confirmRecoveryEmailWithRecoveryCode(input) {
      const snapshot = await db.user.findUnique({
        where: { login: input.login },
        select: {
          id: true,
          recoveryCodeReplacement: {
            select: { newCanonicalKey: true, oldCanonicalKey: true },
          },
        },
      })
      const quotas = recoveryCodeUseQuotas(abuseSecret, requestBudgetPolicies, input)
      return runRetryableAuthTransaction(db, async (tx) => {
        const locks = [
          ...(snapshot ? [{ scope: 'recovery-user', value: snapshot.id }] : []),
          ...(snapshot?.recoveryCodeReplacement
            ? [
                { scope: 'account-email', value: snapshot.recoveryCodeReplacement.oldCanonicalKey },
                { scope: 'account-email', value: snapshot.recoveryCodeReplacement.newCanonicalKey },
              ]
            : []),
        ].sort((left, right) =>
          `${left.scope}:${left.value}`.localeCompare(`${right.scope}:${right.value}`))
        for (const lock of locks) {
          await lockAuthTransactionKey(tx, abuseSecret, lock.scope, lock.value)
        }
        const budgetAvailable = await consumeRecoveryRequestQuotasIpFirst(
          tx,
          abuseSecret,
          quotas,
          input.now,
        )
        const user = await tx.user.findUnique({
          where: { login: input.login },
          select: { id: true, passwordHash: true },
        })
        if (!budgetAvailable || !snapshot || !user?.passwordHash || user.id !== snapshot.id) {
          return null
        }
        const replacement = await tx.recoveryCodeEmailReplacement.findUnique({
          where: { userId: user.id },
        })
        const binding = await tx.recoveryEmailBinding.findUnique({
          where: { userId: user.id },
        })
        if (
          !replacement
          || !binding
          || binding.canonicalKey !== replacement.oldCanonicalKey
          || binding.providerValue !== replacement.oldProviderValue
          || replacement.newExpiresAt <= input.now
          || replacement.newAttemptCount >= 5
        ) {
          return null
        }
        let policy
        try {
          policy = await requireRecoveryEmailPolicy(tx, {
            canonicalKey: replacement.newCanonicalKey,
            providerValue: replacement.newProviderValue,
            requirement: 'new_address',
          })
        } catch (error) {
          if (error instanceof AuthFailure) return null
          throw error
        }
        const presentedHash = hashRecoveryEmailCode(
          abuseSecret,
          user.id,
          replacement.newCanonicalKey,
          input.code,
        )
        if (!codeHashesEqual(replacement.newCodeHash, presentedHash)) {
          await tx.recoveryCodeEmailReplacement.update({
            where: { id: replacement.id },
            data: { newAttemptCount: { increment: 1 } },
          })
          return null
        }
        const [accountOwner, recoveryOwner] = await Promise.all([
          tx.user.findUnique({
            where: { accountEmailCanonicalKey: replacement.newCanonicalKey },
            select: { id: true },
          }),
          tx.recoveryEmailBinding.findUnique({
            where: { canonicalKey: replacement.newCanonicalKey },
            select: { userId: true },
          }),
        ])
        if (
          (accountOwner && accountOwner.id !== user.id)
          || (recoveryOwner && recoveryOwner.userId !== user.id)
        ) {
          return null
        }

        await tx.recoveryEmailBinding.update({
          where: { id: binding.id },
          data: {
            activatesAt: input.activatesAt,
            cancellationSessionIds: [],
            canonicalKey: policy.canonicalKey,
            policyVersion: policy.policyVersion,
            providerValue: policy.providerValue,
            requestedAt: replacement.requestedAt,
          },
        })
        await cancelQueuedTransactionalMail(tx, {
          messageId: replacement.newMessageId,
          now: input.now,
        })
        await tx.recoveryCodeEmailReplacement.delete({ where: { id: replacement.id } })
        await tx.authSession.updateMany({
          where: { revokedAt: null, userId: user.id },
          data: { revokedAt: input.now },
        })
        return { activatesAt: input.activatesAt, providerValue: policy.providerValue }
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
      const quotas = recoveryEmailQuotas(abuseSecret, requestBudgetPolicies, input)

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
      const quotas = recoveryEmailQuotas(abuseSecret, requestBudgetPolicies, {
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
      const quotas = recoveryEmailReplacementQuotas(abuseSecret, requestBudgetPolicies, {
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
      const quotas = recoveryEmailQuotas(abuseSecret, requestBudgetPolicies, {
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
            await revokeRecoveryCodeCredentials(tx, input.userId, input.now)
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
      await runRetryableAuthTransaction(db, async (tx) => {
        await lockAuthTransactionKey(tx, abuseSecret, 'recovery-user', userId)
        await cancelOutstandingRecoveryCredentials(tx, userId, now)
        await tx.recoveryCode.deleteMany({ where: { userId } })
        await tx.recoveryCodeSet.deleteMany({ where: { userId } })
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

async function replaceRecoveryCodeSet(
  tx: Prisma.TransactionClient,
  secret: string,
  input: { codes: string[]; now: Date; userId: string },
) {
  await tx.recoveryCode.deleteMany({ where: { userId: input.userId } })
  await tx.recoveryCodeSet.upsert({
    where: { userId: input.userId },
    create: {
      consumedAt: null,
      issuedAt: input.now,
      userId: input.userId,
    },
    update: {
      consumedAt: null,
      generation: { increment: 1 },
      issuedAt: input.now,
    },
  })
  await tx.recoveryCode.createMany({
    data: input.codes.map((code) => ({
      codeHash: hashRecoveryCode(secret, input.userId, code),
      userId: input.userId,
    })),
  })
}

async function consumeRecoveryCodeSet(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  await tx.recoveryCode.deleteMany({ where: { userId } })
  await tx.recoveryCodeSet.updateMany({
    where: { userId },
    data: { consumedAt: now },
  })
}

async function recoveryCodeMatches(
  tx: Prisma.TransactionClient,
  secret: string,
  userId: string,
  recoveryCode: string,
) {
  const presentedHash = hashRecoveryCode(secret, userId, recoveryCode)
  const stored = await tx.recoveryCode.findMany({
    where: { userId },
    select: { codeHash: true },
  })
  let matched = false
  for (const credential of stored) {
    matched = codeHashesEqual(credential.codeHash, presentedHash) || matched
  }
  if (stored.length === 0) codeHashesEqual('0'.repeat(64), presentedHash)
  return matched
}

function performDummyRecoveryCodeComparison(
  secret: string,
  identity: string,
  recoveryCode: string,
) {
  const presentedHash = hashRecoveryCode(secret, identity, recoveryCode)
  codeHashesEqual('0'.repeat(64), presentedHash)
}

function hashRecoveryCode(secret: string, userId: string, recoveryCode: string) {
  return createHmac('sha256', secret)
    .update('user-held-recovery-code-v1\0')
    .update(userId)
    .update('\0')
    .update(recoveryCode.replace(/[\s-]/g, '').toUpperCase())
    .digest('hex')
}

function recoveryCodeUseQuotas(
  secret: string,
  policies: RequestBudgetPolicyCatalog,
  input: { ipAddress?: string; login: string },
) {
  const definitions = [
    ['login', 'rec_code_login_hour', input.login, policies.rec_code_login_hour],
    ['login', 'rec_code_login_day', input.login, policies.rec_code_login_day],
    ['ip', 'rec_code_ip_hour', input.ipAddress ?? 'unknown', policies.rec_code_ip_hour],
    ['ip', 'rec_code_ip_day', input.ipAddress ?? 'unknown', policies.rec_code_ip_day],
  ] as const
  return definitions.map(([dimension, scope, value, policy]) => ({
    dimension,
    keyHash: hashRecoveryBudgetKey(secret, scope, value),
    limit: policy.limit,
    scope,
    windowMs: policy.windowMs,
  }))
}

function passwordResetRequestQuotas(
  secret: string,
  policies: RequestBudgetPolicyCatalog,
  input: { ipAddress?: string; login: string },
) {
  const definitions = [
    ['login', 'password_reset_login_hour', input.login, policies.password_reset_login_hour],
    ['login', 'password_reset_login_day', input.login, policies.password_reset_login_day],
    ['ip', 'password_reset_ip_hour', input.ipAddress ?? 'unknown', policies.password_reset_ip_hour],
    ['ip', 'password_reset_ip_day', input.ipAddress ?? 'unknown', policies.password_reset_ip_day],
  ] as const
  return definitions.map(([dimension, scope, value, policy]) => ({
    dimension,
    keyHash: hashRecoveryBudgetKey(secret, scope, value),
    limit: policy.limit,
    scope,
    windowMs: policy.windowMs,
  }))
}

type RecoveryRequestQuota = {
  dimension: 'ip' | 'login'
  keyHash: string
  limit: number
  scope: string
  windowMs: number
}

async function consumeRecoveryRequestQuotasIpFirst(
  tx: Prisma.TransactionClient,
  secret: string,
  quotas: readonly RecoveryRequestQuota[],
  now: Date,
) {
  const ipQuotas = quotas.filter((quota) => quota.dimension === 'ip')
  const loginQuotas = quotas.filter((quota) => quota.dimension === 'login')
  await lockRecoveryRequestQuotas(tx, secret, ipQuotas)
  if (!await consumeRecoveryRequestQuotaGroup(tx, ipQuotas, now)) return false

  await lockRecoveryRequestQuotas(tx, secret, loginQuotas)
  return consumeRecoveryRequestQuotaGroup(tx, loginQuotas, now)
}

async function lockRecoveryRequestQuotas(
  tx: Prisma.TransactionClient,
  secret: string,
  quotas: readonly RecoveryRequestQuota[],
) {
  const sorted = [...quotas].sort((left, right) =>
    `${left.scope}:${left.keyHash}`.localeCompare(`${right.scope}:${right.keyHash}`))
  for (const quota of sorted) {
    await lockAuthTransactionKey(
      tx,
      secret,
      'recovery-budget',
      `${quota.scope}:${quota.keyHash}`,
    )
  }
}

async function consumeRecoveryRequestQuotaGroup(
  tx: Prisma.TransactionClient,
  quotas: readonly RecoveryRequestQuota[],
  now: Date,
) {
  let available = true
  for (const quota of quotas) {
    const existing = await tx.authAbuseBucket.findUnique({
      where: { scope_keyHash: { scope: quota.scope, keyHash: quota.keyHash } },
    })
    const windowExpired = !existing || existing.expiresAt <= now
    const count = windowExpired ? 1 : existing.count + 1
    if (count > quota.limit) available = false
    const windowStartedAt = windowExpired ? now : existing.windowStartedAt
    await tx.authAbuseBucket.upsert({
      where: { scope_keyHash: { scope: quota.scope, keyHash: quota.keyHash } },
      create: {
        count: Math.min(count, quota.limit + 1),
        expiresAt: new Date(windowStartedAt.getTime() + quota.windowMs),
        keyHash: quota.keyHash,
        scope: quota.scope,
        windowStartedAt,
      },
      update: {
        blockedUntil: null,
        count: Math.min(count, quota.limit + 1),
        expiresAt: new Date(windowStartedAt.getTime() + quota.windowMs),
        windowStartedAt,
      },
    })
  }
  return available
}

function hashPasswordResetToken(secret: string, token: string) {
  return createHmac('sha256', secret)
    .update('password-reset-token-hash-v1\0')
    .update(token)
    .digest('hex')
}

async function cancelOutstandingRecoveryCredentials(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const [challenge, replacement, reissue, codeReplacement, passwordReset] = await Promise.all([
    tx.recoveryEmailChallenge.findUnique({ where: { userId } }),
    tx.recoveryEmailReplacement.findUnique({ where: { userId } }),
    tx.recoveryCodeReissueChallenge.findUnique({ where: { userId } }),
    tx.recoveryCodeEmailReplacement.findUnique({ where: { userId } }),
    tx.passwordResetCredential.findUnique({ where: { userId } }),
  ])
  const messageIds = [
    challenge?.messageId,
    replacement?.oldMessageId,
    replacement?.newMessageId,
    reissue?.messageId,
    codeReplacement?.newMessageId,
    passwordReset?.messageId,
  ].filter((messageId): messageId is string => Boolean(messageId))
  for (const messageId of messageIds) {
    await cancelQueuedTransactionalMail(tx, { messageId, now })
  }
  await tx.recoveryEmailChallenge.deleteMany({ where: { userId } })
  await tx.recoveryEmailReplacement.deleteMany({ where: { userId } })
  await tx.recoveryCodeReissueChallenge.deleteMany({ where: { userId } })
  await tx.recoveryCodeEmailReplacement.deleteMany({ where: { userId } })
  await tx.passwordResetCredential.deleteMany({ where: { userId } })
}

async function revokeRecoveryCodeCredentials(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const [reissue, replacement] = await Promise.all([
    tx.recoveryCodeReissueChallenge.findUnique({ where: { userId } }),
    tx.recoveryCodeEmailReplacement.findUnique({ where: { userId } }),
  ])
  for (const messageId of [reissue?.messageId, replacement?.newMessageId]) {
    if (messageId) await cancelQueuedTransactionalMail(tx, { messageId, now })
  }
  await tx.recoveryCodeReissueChallenge.deleteMany({ where: { userId } })
  await tx.recoveryCodeEmailReplacement.deleteMany({ where: { userId } })
  await consumeRecoveryCodeSet(tx, userId, now)
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
  const windowStartedAt = windowExpired ? input.now : existing.windowStartedAt
  const expiresAt = new Date(windowStartedAt.getTime() + input.windowMs)
  if (count > input.limit) {
    throw new AuthFailure(
      'registration_limited',
      'Registration limit reached. Try again later.',
      retryAfterSeconds(expiresAt, input.now),
    )
  }
  await tx.authAbuseBucket.upsert({
    where: { scope_keyHash: { scope: input.scope, keyHash: input.keyHash } },
    create: {
      count,
      expiresAt,
      keyHash: input.keyHash,
      scope: input.scope,
      windowStartedAt,
    },
    update: {
      blockedUntil: null,
      count,
      expiresAt,
      windowStartedAt,
    },
  })
}

function recoveryEmailQuotas(
  secret: string,
  policies: RequestBudgetPolicyCatalog,
  input: { canonicalKey: string; ipAddress?: string; userId: string },
) {
  const definitions = [
    ['rec_email_account_min', input.userId, policies.rec_email_account_min, 1],
    ['rec_email_account_hour', input.userId, policies.rec_email_account_hour, 1],
    ['rec_email_account_day', input.userId, policies.rec_email_account_day, 1],
    ['rec_email_address_min', input.canonicalKey, policies.rec_email_address_min, 1],
    ['rec_email_address_hour', input.canonicalKey, policies.rec_email_address_hour, 1],
    ['rec_email_address_day', input.canonicalKey, policies.rec_email_address_day, 1],
    ['rec_email_ip_hour', input.ipAddress ?? 'unknown', policies.rec_email_ip_hour, 1],
  ] as const
  return definitions.map(([scope, value, policy, cost]) => ({
    cost,
    keyHash: hashRecoveryBudgetKey(secret, scope, value),
    limit: policy.limit,
    scope,
    windowMs: policy.windowMs,
  }))
}

function recoveryEmailReplacementQuotas(
  secret: string,
  policies: RequestBudgetPolicyCatalog,
  input: {
    ipAddress?: string
    newCanonicalKey: string
    oldCanonicalKey: string
    userId: string
  },
) {
  const definitions = [
    ['rec_email_account_min', input.userId, policies.rec_email_account_min, 1],
    ['rec_email_account_hour', input.userId, policies.rec_email_account_hour, 2],
    ['rec_email_account_day', input.userId, policies.rec_email_account_day, 2],
    ['rec_email_address_min', input.oldCanonicalKey, policies.rec_email_address_min, 1],
    ['rec_email_address_hour', input.oldCanonicalKey, policies.rec_email_address_hour, 1],
    ['rec_email_address_day', input.oldCanonicalKey, policies.rec_email_address_day, 1],
    ['rec_email_address_min', input.newCanonicalKey, policies.rec_email_address_min, 1],
    ['rec_email_address_hour', input.newCanonicalKey, policies.rec_email_address_hour, 1],
    ['rec_email_address_day', input.newCanonicalKey, policies.rec_email_address_day, 1],
    ['rec_email_ip_hour', input.ipAddress ?? 'unknown', policies.rec_email_ip_hour, 2],
  ] as const
  return definitions.map(([scope, value, policy, cost]) => ({
    cost,
    keyHash: hashRecoveryBudgetKey(secret, scope, value),
    limit: policy.limit,
    scope,
    windowMs: policy.windowMs,
  }))
}

async function consumeRecoveryEmailQuota(
  tx: Prisma.TransactionClient,
  input: {
    cost?: number
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
  const cost = input.cost ?? 1
  const count = windowExpired ? cost : existing.count + cost
  const windowStartedAt = windowExpired ? input.now : existing.windowStartedAt
  const expiresAt = new Date(windowStartedAt.getTime() + input.windowMs)
  if (count > input.limit) {
    throw new AuthFailure(
      'recovery_email_limited',
      'Recovery Email request is temporarily unavailable',
      retryAfterSeconds(expiresAt, input.now),
    )
  }
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

function retryAfterSeconds(expiresAt: Date, now: Date) {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000))
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
  return isRetryableDatabaseTransactionConflict(error)
    || (typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'P2025')
    || (typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'P2002'
      && 'meta' in error
      && typeof error.meta === 'object'
      && error.meta !== null
      && 'modelName' in error.meta
      && error.meta.modelName === 'AuthAbuseBucket')
}

async function runRetryableAuthTransaction<T>(
  db: DbClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(operation)
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 10 * (2 ** attempt)))
    }
  }

  throw new Error('Unreachable auth transaction retry state')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
