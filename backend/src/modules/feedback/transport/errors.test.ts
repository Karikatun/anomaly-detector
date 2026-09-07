import { expect, test } from 'bun:test'

import { FeedbackFailure } from '../domain/errors'
import { executeFeedbackOperator } from './errors'

test('conceals an operator command rejected by account deletion', async () => {
  const operation = executeFeedbackOperator(async () => {
    throw new FeedbackFailure(
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
