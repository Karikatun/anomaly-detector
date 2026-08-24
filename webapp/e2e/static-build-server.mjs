import { existsSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const kind = process.argv[2]
if (kind !== 'webapp' && kind !== 'website') {
  throw new Error('Static E2E server kind must be webapp or website')
}

const port = Number(process.env.E2E_STATIC_PORT)
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error('E2E_STATIC_PORT must be a valid port')
}

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = resolve(frontendRoot, '..')
const projectRoot = resolve(repositoryRoot, kind)
const artifactRoot = resolve(frontendRoot, 'e2e/.artifacts')
const outputDirectory = process.env.SPLIT_DOMAIN_BUILD_OUT_DIR
if (!outputDirectory) throw new Error('SPLIT_DOMAIN_BUILD_OUT_DIR is required')
const distRoot = resolve(outputDirectory)
if (!distRoot.startsWith(`${artifactRoot}${sep}`)) {
  throw new Error('Split-domain E2E build output must stay inside e2e/.artifacts')
}
const build = spawnSync('bun', ['run', 'build'], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
})
if (build.status !== 0) throw new Error(`${kind} E2E build failed`)

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(request) {
    const requestUrl = new URL(request.url)
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '')
    const requestedPath = resolve(distRoot, relativePath || 'index.html')
    if (!requestedPath.startsWith(`${distRoot}${sep}`)) {
      return new Response('Not found', { status: 404 })
    }

    if (existsSync(requestedPath) && statSync(requestedPath).isFile()) {
      return new Response(Bun.file(requestedPath))
    }
    if (kind === 'webapp') return new Response(Bun.file(resolve(distRoot, 'index.html')))
    return new Response('Not found', { status: 404 })
  },
})

console.log(`${kind} static E2E build listening on ${server.url}`)
