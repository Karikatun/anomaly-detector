import { createHmac, randomBytes } from 'node:crypto'

import { feedbackIntakeRequestSchema } from '@anomaly-detector/contracts'

import type { DbClient } from '../../../db'
import type { FeedbackIntake } from '../application/ports'

const ACCOUNT_SCOPE = 'feedback_account_day'
const IP_SCOPE = 'feedback_ip_day'
const ACCOUNT_LIMIT = 5
const IP_LIMIT = 20
const WINDOW_MS = 24 * 60 * 60 * 1_000
const PUBLIC_NUMBER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

type FeedbackIntakeOptions = {
  clock?: { now(): Date }
  publicNumber?: () => string
}

const systemClock = { now: () => new Date() }

export function createPrismaFeedbackIntake(
  db: DbClient,
  fingerprintKey: string,
  options: FeedbackIntakeOptions = {},
): FeedbackIntake {
  const clock = options.clock ?? systemClock
  const generatePublicNumber = options.publicNumber ?? randomPublicNumber

  return {
    async submit(input) {
      const report = feedbackIntakeRequestSchema.parse(input.report)
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const now = clock.now()
        const publicNumber = generatePublicNumber()
        try {
          return await db.$transaction(async (tx) => {
            const accountKeyHash = budgetKey(
              fingerprintKey,
              ACCOUNT_SCOPE,
              input.userId,
            )
            const ipKeyHash = budgetKey(
              fingerprintKey,
              IP_SCOPE,
              input.clientAddress,
            )
            const keys = [
              { keyHash: accountKeyHash, limit: ACCOUNT_LIMIT, scope: ACCOUNT_SCOPE },
              { keyHash: ipKeyHash, limit: IP_LIMIT, scope: IP_SCOPE },
            ].sort((left, right) => `${left.scope}:${left.keyHash}`.localeCompare(`${right.scope}:${right.keyHash}`))

            for (const key of keys) {
              await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${key.scope}:${key.keyHash}`}, 0))::text AS "lock"`
            }

            const states = await Promise.all(keys.map(async (key) => {
              const existing = await tx.authAbuseBucket.findUnique({
                where: { scope_keyHash: { keyHash: key.keyHash, scope: key.scope } },
              })
              if (!existing || existing.expiresAt <= now) {
                return {
                  ...key,
                  count: 0,
                  expiresAt: new Date(now.getTime() + WINDOW_MS),
                  windowStartedAt: now,
                }
              }
              return {
                ...key,
                count: existing.count,
                expiresAt: existing.expiresAt,
                windowStartedAt: existing.windowStartedAt,
              }
            }))
            const exhausted = states.filter((state) => state.count >= state.limit)
            if (exhausted.length > 0) {
              return {
                kind: 'rate_limited' as const,
                retryAfterSeconds: Math.max(
                  1,
                  ...exhausted.map((state) =>
                    Math.ceil((state.expiresAt.getTime() - now.getTime()) / 1_000)),
                ),
              }
            }

            for (const state of states) {
              await tx.authAbuseBucket.upsert({
                where: { scope_keyHash: { keyHash: state.keyHash, scope: state.scope } },
                create: {
                  blockedUntil: null,
                  count: 1,
                  expiresAt: state.expiresAt,
                  keyHash: state.keyHash,
                  scope: state.scope,
                  windowStartedAt: state.windowStartedAt,
                },
                update: {
                  blockedUntil: null,
                  count: state.count + 1,
                  expiresAt: state.expiresAt,
                  windowStartedAt: state.windowStartedAt,
                },
              })
            }

            await tx.feedbackReport.create({
              data: {
                ...reportSource(report),
                browserClass: report.technicalContext.browserClass,
                buildSha: report.technicalContext.buildSha,
                deviceClass: report.technicalContext.deviceClass,
                errorId: report.technicalContext.errorId,
                linkedUserId: report.linkAccount ? input.userId : null,
                publicNumber,
                replyEmail: report.replyEmail,
                routeTemplate: report.technicalContext.routeTemplate,
              },
            })

            return {
              kind: 'accepted' as const,
              receipt: {
                acceptedAt: now.toISOString(),
                publicNumber,
              },
            }
          })
        } catch (error) {
          if (!isPublicNumberConflict(error) || attempt === 2) throw error
        }
      }

      throw new Error('feedback public number allocation exhausted')
    },
  }
}

function reportSource(report: ReturnType<typeof feedbackIntakeRequestSchema.parse>) {
  if (report.category === 'error') {
    return {
      category: report.category,
      errorCanContinue: report.canContinue,
      errorExpectedResult: report.expectedResult,
      errorReproductionSteps: report.reproductionSteps,
      errorWhatHappened: report.whatHappened,
      suggestionDesiredChange: null,
      suggestionProblemSolved: null,
    }
  }
  return {
    category: report.category,
    errorCanContinue: null,
    errorExpectedResult: null,
    errorReproductionSteps: null,
    errorWhatHappened: null,
    suggestionDesiredChange: report.desiredChange,
    suggestionProblemSolved: report.problemSolved,
  }
}

function budgetKey(secret: string, scope: string, value: string) {
  return createHmac('sha256', secret)
    .update(`feedback-budget:${scope}:${value}`)
    .digest('hex')
}

function randomPublicNumber() {
  const suffix = Array.from(
    randomBytes(10),
    (byte) => PUBLIC_NUMBER_ALPHABET[byte & 31],
  ).join('')
  return `FB-${suffix}`
}

function isPublicNumberConflict(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2002') {
    return false
  }
  const meta = 'meta' in error && typeof error.meta === 'object' && error.meta !== null
    ? error.meta
    : null
  if (!meta || !('modelName' in meta) || meta.modelName !== 'FeedbackReport') return false
  const target = 'target' in meta ? meta.target : undefined
  return Array.isArray(target)
    ? target.includes('public_number') || target.includes('publicNumber')
    : String(target).includes('public_number') || String(target).includes('publicNumber')
}
