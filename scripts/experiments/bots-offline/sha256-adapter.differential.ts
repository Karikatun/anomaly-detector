import { createHash as nativeCreateHash } from 'node:crypto'

import { createHash as browserCreateHash } from './sha256-adapter'

const command = JSON.stringify({ actorId: 'local-human', commandId: 'команда-Δ', tenderId: 'tender-123', type: 'allocate-power' })
const cases = ['', 'abc', command, 'x'.repeat(65), 'signal-'.repeat(200)]
for (const input of cases) {
  const expected = nativeCreateHash('sha256').update(input).digest('hex')
  const actual = browserCreateHash('sha256').update(input).digest('hex')
  const chunks = browserCreateHash('sha256').update(input.slice(0, 3)).update(input.slice(3, 71)).update(input.slice(71)).digest('hex')
  if (actual !== expected || chunks !== expected) throw new Error(`SHA-256 mismatch for ${input.length} characters`)
}
console.log(`CRYPTO_DIFFERENTIAL_PASS ${cases.length} vectors`)
