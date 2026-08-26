import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  localDockerEndpointFromContextInspect,
  splitDomainComposeProjectName,
  splitDomainProcessEnvironment,
} from './split-domain-run.mjs'

const webappRoot = fileURLToPath(new URL('..', import.meta.url))
const invocationId = `${process.pid}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
const requestedMode = process.argv[2]
if (requestedMode && requestedMode !== 'target' && requestedMode !== 'rollback') {
  throw new Error('Split-domain runner mode must be target or rollback')
}
const modes = requestedMode ? [requestedMode] : ['target', 'rollback']
const isolatedBaseEnvironment = splitDomainProcessEnvironment(process.env, {})
const dockerContext = spawnSync('docker', ['context', 'inspect'], {
  cwd: resolve(webappRoot, '..'),
  encoding: 'utf8',
  env: isolatedBaseEnvironment,
  stdio: ['ignore', 'pipe', 'ignore'],
})
if (dockerContext.status !== 0) {
  throw new Error('Split-domain E2E could not inspect the local Docker context')
}
const localDockerEndpoint = localDockerEndpointFromContextInspect(dockerContext.stdout)

for (const mode of modes) {
  const composeProjectName = splitDomainComposeProjectName(invocationId, mode)
  console.log(`Split-domain ${mode} uses isolated Compose project ${composeProjectName}`)
  const result = spawnSync(
    'bun',
    ['x', 'playwright', 'test', '--config=playwright.split-domain.config.ts'],
    {
      cwd: resolve(webappRoot),
      env: splitDomainProcessEnvironment(isolatedBaseEnvironment, {
        COMPOSE_PROJECT_NAME: composeProjectName,
        DOCKER_HOST: localDockerEndpoint,
        E2E_SPLIT_DOMAIN_MODE: mode,
      }),
      stdio: 'inherit',
    },
  )
  if (result.status !== 0) throw new Error(`Split-domain ${mode} E2E failed`)
}
