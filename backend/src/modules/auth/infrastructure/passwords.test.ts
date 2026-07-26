import { describe, expect, test } from 'bun:test'

import { hashPassword, passwordHashNeedsRehash, verifyPassword } from './passwords'

describe('passwords', () => {
  test('hashes with the explicit Argon2id policy and verifies without storing plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple')
    const hashWithAnotherSalt = await hashPassword('correct horse battery staple')

    expect(hash.startsWith('$argon2id$v=19$m=65536,t=2,p=1$')).toBe(true)
    expect(hash).not.toContain('correct horse battery staple')
    expect(hashWithAnotherSalt).not.toBe(hash)
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('wrong password', hash)).toBe(false)
    expect(passwordHashNeedsRehash(hash)).toBe(false)
  })

  test('recognises weaker and invalid password hashes for opportunistic rehash', async () => {
    const weakerHash = await Bun.password.hash('correct horse battery staple', {
      algorithm: 'argon2id',
      memoryCost: 19_456,
      timeCost: 2,
    })

    expect(await verifyPassword('correct horse battery staple', weakerHash)).toBe(true)
    expect(passwordHashNeedsRehash(weakerHash)).toBe(true)
    expect(passwordHashNeedsRehash('OAUTH_USER')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', 'OAUTH_USER')).toBe(false)
  })
})
