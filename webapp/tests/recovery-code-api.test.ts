import { expect, test } from 'bun:test'

import { RecoveryCodeApi } from '../src/features/auth/recovery-code-api'
import type { HttpClient } from '../src/platform/api'

test('public Recovery Code API sends only bounded recovery inputs', async () => {
  const requests: Array<{ body?: unknown; method?: string; path: string }> = []
  const api = new RecoveryCodeApi({
    request: async (path, schema, options) => {
      requests.push({ path, method: options?.method, body: options?.body })
      if (path.endsWith('/recovery-email/start')) {
        return schema.parse({
          codeExpiresAt: '2030-08-22T15:15:00.000Z',
          maskedAccountEmail: 'n***@mail.ru',
          outcome: 'pending',
        })
      }
      if (path.endsWith('/recovery-email/confirm')) {
        return schema.parse({
          activatesAt: '2030-08-23T15:15:00.000Z',
          maskedAccountEmail: 'n***@mail.ru',
          outcome: 'completed',
        })
      }
      return schema.parse({ outcome: 'completed' })
    },
  } as unknown as Pick<HttpClient, 'request'>)

  await api.recoverPassword({
    login: 'player-one',
    newPassword: 'new-password-123',
    recoveryCode: 'aaaa bbbb cccc dddd eeee ffff 0000 1111',
  })
  await api.startRecoveryEmailReplacement({
    email: 'new@mail.ru',
    login: 'player-one',
    recoveryCode: '2222-3333-4444-5555-6666-7777-8888-9999',
  })
  await api.confirmRecoveryEmailReplacement({ code: '123456', login: 'player-one' })

  expect(requests).toEqual([
    {
      body: {
        login: 'player-one',
        newPassword: 'new-password-123',
        recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111',
      },
      method: 'POST',
      path: '/api/auth/recovery-code/password',
    },
    {
      body: {
        email: 'new@mail.ru',
        login: 'player-one',
        recoveryCode: '2222-3333-4444-5555-6666-7777-8888-9999',
      },
      method: 'POST',
      path: '/api/auth/recovery-code/recovery-email/start',
    },
    {
      body: { code: '123456', login: 'player-one' },
      method: 'POST',
      path: '/api/auth/recovery-code/recovery-email/confirm',
    },
  ])
})
