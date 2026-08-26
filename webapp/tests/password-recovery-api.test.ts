import { expect, test } from 'bun:test'

import { PasswordRecoveryApi } from '../src/features/auth/password-recovery-api'
import type { HttpClient } from '../src/platform/api'

test('password recovery API keeps request and completion payloads bounded', async () => {
  const requests: Array<{ body?: unknown; method?: string; path: string }> = []
  const api = new PasswordRecoveryApi({
    request: async (path, schema, options) => {
      requests.push({ body: options?.body, method: options?.method, path })
      return schema.parse({
        outcome: path.endsWith('/request') ? 'accepted' : 'completed',
      })
    },
  } as unknown as Pick<HttpClient, 'request'>)

  await expect(api.requestReset({ login: 'owner' })).resolves.toEqual({ outcome: 'accepted' })
  await expect(api.completeReset({
    newPassword: 'new-password123',
    token: 'A'.repeat(43),
  })).resolves.toEqual({ outcome: 'completed' })
  expect(requests).toEqual([
    {
      body: { login: 'owner' },
      method: 'POST',
      path: '/api/auth/password-recovery/request',
    },
    {
      body: { newPassword: 'new-password123', token: 'A'.repeat(43) },
      method: 'POST',
      path: '/api/auth/password-recovery/complete',
    },
  ])
})
