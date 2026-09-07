import { expect, test } from 'bun:test'

import type { DbClient } from '../../db'
import { createMailModule } from '.'

test('keeps protection-alert dispatch available while SMTP delivery is disabled', () => {
  const mail = createMailModule({
    accountLifecycleSecret: 'test-mail-module-lifecycle-secret',
    db: {} as DbClient,
    deliveryOptions: {
      circuitFailureThreshold: 3,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 30_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    },
  })

  expect(mail.outboxDrainer).toBeNull()
  expect(mail.protectionAlertDispatcher).not.toBeNull()
})
