import { z } from 'zod'

import type { Clock } from './ports'
import type {
  ClaimedMailDeliveryProtectionAlert,
  MailOutboxRepository,
} from './transactional-mail-ports'

const workerIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/)

export class MailDeliveryProtectionAlertService {
  constructor(private readonly dependencies: {
    clock?: Clock
    repository: MailOutboxRepository
  }) {}

  async dispatch(input: {
    deliver(alert: ClaimedMailDeliveryProtectionAlert): Promise<void> | void
    limit: number
    now: Date
    workerId: string
  }) {
    const limit = z.number().int().min(1).max(100).parse(input.limit)
    const workerId = workerIdSchema.parse(input.workerId)
    const alerts = await this.dependencies.repository.claimProtectionAlerts({
      limit,
      now: input.now,
      workerId,
    })
    const result = {
      claimed: alerts.length,
      delivered: 0,
      failed: 0,
      staleClaims: 0,
    }

    for (const alert of alerts) {
      try {
        await input.deliver(alert)
      } catch {
        result.failed += 1
        const state = await this.dependencies.repository.recordProtectionAlertFailure({
          now: this.now(input.now),
          reason: alert.reason,
          transitionAt: alert.transitionAt,
          workerId,
        })
        if (state === 'stale_claim') result.staleClaims += 1
        continue
      }
      const acknowledged = await this.dependencies.repository.acknowledgeProtectionAlert({
        now: this.now(input.now),
        reason: alert.reason,
        transitionAt: alert.transitionAt,
        workerId,
      })
      if (acknowledged) result.delivered += 1
      else result.staleClaims += 1
    }

    return result
  }

  private now(fallback: Date) {
    return this.dependencies.clock?.now() ?? fallback
  }
}
