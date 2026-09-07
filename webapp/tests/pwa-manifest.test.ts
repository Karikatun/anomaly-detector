import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const manifestPath = resolve(import.meta.dir, '../public/site.webmanifest')

test('publishes a stable player-app launch boundary', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>

  expect(manifest).toMatchObject({
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  })
})
