import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const tools = JSON.parse(readFileSync(resolve(repositoryRoot, '.security/tools.json'), 'utf8'))
const scratchRoot = resolve(repositoryRoot, '.scratch/security')

function sourceMount() {
  return `${repositoryRoot}:/src:ro`
}

function currentDockerSocket() {
  const configuredHost = process.env.DOCKER_HOST
  if (configuredHost?.startsWith('unix://')) return configuredHost.slice('unix://'.length)

  const inspected = spawnSync(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { encoding: 'utf8' },
  )
  const host = inspected.status === 0 ? inspected.stdout.trim() : ''
  return host.startsWith('unix://') ? host.slice('unix://'.length) : '/var/run/docker.sock'
}

function plan(scanner, positional) {
  switch (scanner) {
    case 'gitleaks':
      return {
        command: 'docker',
        args: [
          'run', '--rm',
          '--volume', sourceMount(),
          '--workdir', '/src',
          tools.gitleaks.image,
          'git', '--no-banner', '--redact=100', '--verbose', '/src',
        ],
      }
    case 'semgrep':
      return {
        command: 'docker',
        args: [
          'run', '--rm',
          '--volume', sourceMount(),
          '--workdir', '/src',
          '--entrypoint', 'semgrep',
          tools.semgrep.image,
          'scan',
          '--config', '/src/.semgrep/security.yml',
          '--error',
          '--metrics=off',
          '--exclude', 'backend/src/generated',
          '--exclude', 'node_modules',
          '--exclude', 'dist',
          '--exclude', 'coverage',
          '/src/backend', '/src/packages', '/src/webapp/src', '/src/adminapp/src', '/src/scripts',
        ],
      }
    case 'trivy-config':
      mkdirSync(resolve(scratchRoot, 'trivy-cache'), { recursive: true })
      return {
        command: 'docker',
        args: [
          'run', '--rm',
          '--volume', sourceMount(),
          '--volume', `${resolve(scratchRoot, 'trivy-cache')}:/root/.cache/trivy`,
          '--entrypoint', 'trivy',
          tools.trivy.image,
          'fs',
          '--scanners', 'misconfig',
          '--severity', 'HIGH,CRITICAL',
          '--exit-code', '1',
          '--skip-dirs', '/src/.scratch',
          '--skip-dirs', '/src/node_modules',
          '--skip-dirs', '/src/backend/src/generated',
          '/src',
        ],
      }
    case 'trivy-image': {
      const image = positional[0]
      if (!image) throw new Error('trivy-image requires an image reference')
      mkdirSync(resolve(scratchRoot, 'trivy-cache'), { recursive: true })
      return {
        command: 'docker',
        args: [
          'run', '--rm',
          '--volume', `${currentDockerSocket()}:/var/run/docker.sock`,
          '--volume', `${resolve(scratchRoot, 'trivy-cache')}:/root/.cache/trivy`,
          '--entrypoint', 'trivy',
          tools.trivy.image,
          'image',
          '--scanners', 'vuln',
          '--pkg-types', 'os,library',
          '--severity', 'HIGH,CRITICAL',
          '--exit-code', '1',
          image,
        ],
      }
    }
    default:
      throw new Error(`Unknown security scanner: ${scanner ?? '<missing>'}`)
  }
}

function run(scanPlan) {
  const result = spawnSync(scanPlan.command, scanPlan.args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    const scanner = args.shift()
    const dryRunIndex = args.indexOf('--dry-run')
    const dryRun = dryRunIndex !== -1
    if (dryRun) args.splice(dryRunIndex, 1)
    const scanPlan = plan(scanner, args)
    if (dryRun) {
      process.stdout.write(`${JSON.stringify(scanPlan)}\n`)
    } else {
      run(scanPlan)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
