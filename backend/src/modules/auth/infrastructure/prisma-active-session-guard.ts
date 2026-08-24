import type { DbClient } from '../../../db'
import type { ActiveSessionGuard, ActiveSessionPrincipal } from '../application/ports'

const DAY_MS = 24 * 60 * 60 * 1_000

type LockedSession = {
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
}

export function createPrismaActiveSessionGuard(
  db: DbClient,
  input: {
    now?: () => Date
    sessionAbsoluteTtlDays: number
  },
): ActiveSessionGuard {
  const now = input.now ?? (() => new Date())

  const isActive = async ({ sessionId, userId }: ActiveSessionPrincipal) => {
    const checkedAt = now()
    const createdAfter = new Date(
      checkedAt.getTime() - input.sessionAbsoluteTtlDays * DAY_MS,
    )
    const session = await db.authSession.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: checkedAt },
        createdAt: { gt: createdAfter },
      },
      select: { id: true },
    })
    return session !== null
  }

  const runWhileActive: ActiveSessionGuard['runWhileActive'] = async (
    { sessionId, userId },
    action,
  ) => db.$transaction(async (tx) => {
    const sessions = await tx.$queryRaw<LockedSession[]>`
      SELECT
        created_at AS "createdAt",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt"
      FROM auth_sessions
      WHERE id = CAST(${sessionId} AS uuid)
        AND user_id = CAST(${userId} AS uuid)
      FOR SHARE
    `
    const checkedAt = now()
    const createdAfter = new Date(
      checkedAt.getTime() - input.sessionAbsoluteTtlDays * DAY_MS,
    )
    const session = sessions[0]
    if (
      !session
      || session.revokedAt !== null
      || session.expiresAt <= checkedAt
      || session.createdAt <= createdAfter
    ) return false

    action()
    return true
  })

  return { isActive, runWhileActive }
}
