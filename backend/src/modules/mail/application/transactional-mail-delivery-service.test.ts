import { expect, test } from 'bun:test'

import { TransactionalMailDeliveryService } from './transactional-mail-delivery-service'

test('renews the owned lease immediately before SMTP and skips a stale claim', async () => {
  const now = new Date('2026-09-04T10:00:00.000Z')
  const calls: string[] = []
  let claimed = false
  const service = new TransactionalMailDeliveryService({
    confirmationCodeSecret: 'test-confirmation-secret',
    delivery: {
      send: async () => {
        calls.push('smtp')
        return { kind: 'accepted' as const }
      },
    },
    policy: {
      evaluate: async () => {
        calls.push('policy')
        return { acceptsNewAddress: true, allowsRecoveryDelivery: true }
      },
    },
    repository: {
      acknowledgeProtectionAlert: async () => false,
      assignPolicyProvider: async () => true,
      claim: async () => {
        if (claimed) return { kind: 'empty' as const }
        claimed = true
        return {
          kind: 'claimed' as const,
          message: {
            attemptCount: 1,
            circuitProbe: false,
            createdAt: now,
            deliveryBudgetWindowStartedAt: now,
            id: '019f8099-7e26-7760-ad08-66d1d66b2810',
            leaseExpiresAt: new Date(now.getTime() + 60_000),
            messageId: '019f8099-7e26-7760-ad08-66d1d66b2811',
            providerMessageId: '<019f8099-7e26-7760-ad08-66d1d66b2811@anomaly-detector.ru>',
            recipient: 'researcher@yandex.ru',
            recipientDomain: 'yandex.ru',
            template: {
              event: 'password_changed',
              kind: 'security_notification',
              occurredAt: now.toISOString(),
            },
          },
        }
      },
      claimProtectionAlerts: async () => [],
      recordAccepted: async () => {
        calls.push('ack')
        return true
      },
      recordFailure: async () => ({ state: 'queued' as const }),
      recordProtectionAlertFailure: async () => 'queued' as const,
      releaseBlocked: async () => true,
      renewLeaseForDelivery: async () => {
        calls.push('renew')
        return false
      },
    },
  })

  await expect(service.drain({ limit: 1, now, workerId: 'mail-worker-a' })).resolves.toMatchObject({
    accepted: 0,
    staleClaims: 1,
  })
  expect(calls).toEqual(['policy', 'renew'])
})

test('records alert delivery failure before returning it to the retry backlog', async () => {
  const now = new Date('2026-09-04T10:00:00.000Z')
  const calls: string[] = []
  const alert = {
    occurredAt: now,
    reason: 'delivery_circuit_open' as const,
    transitionAt: new Date('2026-09-04T10:01:00.000Z'),
  }
  const service = new TransactionalMailDeliveryService({
    confirmationCodeSecret: 'test-confirmation-secret',
    delivery: { send: async () => ({ kind: 'accepted' }) },
    policy: {
      evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }),
    },
    repository: {
      acknowledgeProtectionAlert: async () => {
        calls.push('ack')
        return true
      },
      assignPolicyProvider: async () => true,
      claim: async () => ({ kind: 'empty' }),
      claimProtectionAlerts: async () => [alert],
      recordAccepted: async () => true,
      recordFailure: async () => ({ state: 'queued' }),
      recordProtectionAlertFailure: async () => {
        calls.push('record_failure')
        return 'queued' as const
      },
      releaseBlocked: async () => true,
      renewLeaseForDelivery: async () => true,
    },
  })

  await expect(service.dispatchProtectionAlerts({
    deliver: () => {
      calls.push('deliver')
      throw new Error('logging unavailable')
    },
    limit: 1,
    now,
    workerId: 'alert-worker-a',
  })).resolves.toEqual({ claimed: 1, delivered: 0, failed: 1, staleClaims: 0 })
  expect(calls).toEqual(['deliver', 'record_failure'])
})
