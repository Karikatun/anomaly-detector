import { expect, test } from 'bun:test'

import { MailPolicyFailure } from '../domain/errors'
import { executeMailPolicy } from './errors'

test('conceals a policy command rejected by account deletion', async () => {
  const operation = executeMailPolicy(async () => {
    throw new MailPolicyFailure(
      'operator_unavailable',
      'Operator access is no longer available',
    )
  })

  await expect(operation).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Route not found',
    status: 404,
  })
})
