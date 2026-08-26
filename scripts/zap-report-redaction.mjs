import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

const reports = [
  ['raw-report.html', 'report.html'],
  ['raw-report.json', 'report.json'],
  ['raw-report.md', 'report.md'],
]

function readRegularFile(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(`ZAP report source must be a regular file: ${basename(path)}`)
    }
    return readFileSync(descriptor, 'utf8')
  } finally {
    closeSync(descriptor)
  }
}

export function publishRedactedZapReports(rawDirectory, sanitizedDirectory, secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('ZAP report redaction requires a non-empty secret')
  }

  const stagingDirectory = resolve(
    dirname(sanitizedDirectory),
    `.${basename(sanitizedDirectory)}-${process.pid}-${randomUUID()}`,
  )
  let publicationError
  let cleanupError
  let published = false

  try {
    mkdirSync(stagingDirectory, { mode: 0o700 })
    for (const [rawName, sanitizedName] of reports) {
      const source = readRegularFile(resolve(rawDirectory, rawName))
      const redacted = source.replaceAll(secret, '[REDACTED]')
      const destination = resolve(stagingDirectory, sanitizedName)

      writeFileSync(destination, redacted, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      if (readFileSync(destination, 'utf8').includes(secret)) {
        throw new Error(`ZAP report still contains the scan credential: ${sanitizedName}`)
      }
    }

    renameSync(stagingDirectory, sanitizedDirectory)
    published = true
  } catch (error) {
    publicationError = error
  }

  try {
    if (!published) rmSync(stagingDirectory, { force: true, recursive: true })
    rmSync(rawDirectory, { force: true, recursive: true })
  } catch (error) {
    cleanupError = error
  }

  if (publicationError && cleanupError) {
    throw new AggregateError(
      [publicationError, cleanupError],
      'ZAP report publication and raw-report cleanup both failed',
    )
  }
  if (publicationError) throw publicationError
  if (cleanupError) throw cleanupError
}
