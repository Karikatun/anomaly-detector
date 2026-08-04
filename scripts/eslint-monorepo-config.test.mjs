import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { ESLint } from 'eslint'

const repositoryRoot = resolve(import.meta.dir, '..')

test('loads adminapp and webapp ESLint configs in one editor process', async () => {
  const admin = new ESLint({ cwd: resolve(repositoryRoot, 'adminapp') })
  const web = new ESLint({ cwd: resolve(repositoryRoot, 'webapp') })

  const results = [
    ...await admin.lintFiles(['src/main.tsx']),
    ...await web.lintFiles(['src/components/ui/dialog.tsx']),
  ]
  const parsingErrors = results.flatMap((result) =>
    result.messages
      .filter((message) => message.fatal)
      .map((message) => message.message),
  )

  expect(parsingErrors).toEqual([])
})
