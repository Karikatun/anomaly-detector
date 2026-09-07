import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  localDockerEndpointFromContextInspect,
  splitDomainProcessEnvironment,
} from '../webapp/e2e/split-domain-run.mjs'

const image = 'caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648'
let dockerEnvironment = splitDomainProcessEnvironment(process.env, {})
const credentials = `Basic ${Buffer.from('fixture:synthetic-static-test').toString('base64')}`
const blocked = [
  '/.env', '/.git/config', '/.env.bak', '/backup.zip', '/missing.bak',
  '/nested/.env.bak', '/nested/export.SQL.gz', '/.ENV', '/%2eenv',
  '/.git%2fconfig', '/.well-known/.env', '/.well-known/nested/.git/config',
  '/assets/app.js.map', '/nested/settings.json~',
]

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', env: dockerEnvironment, timeout: 30_000 })
  if (result.status !== 0) throw new Error(`Docker fixture failed: ${result.stderr || result.error?.message}`)
  return result.stdout.trim()
}

for (const profile of ['target', 'rollback']) {
  describe(`real Caddy static boundary (${profile})`, () => {
    let root
    let container
    const origins = {}
    const hosts = ['anomaly-detector.ru', 'app.anomaly-detector.ru', 'ops.anomaly-detector.ru']
    beforeAll(async () => {
      const endpoint = localDockerEndpointFromContextInspect(docker(['context', 'inspect']))
      dockerEnvironment = splitDomainProcessEnvironment(process.env, { DOCKER_HOST: endpoint })
      root = mkdtempSync(join(tmpdir(), 'anomaly-caddy-static-'))
      const publicRoot = join(root, 'public')
      const files = [...blocked.filter((path) => !path.includes('%') && path !== '/missing.bak'),
        '/index.html', '/assets/app.js', '/.well-known/security.txt', '/.well-known/acme-challenge/fixture']
      for (const path of files) {
        const destination = join(publicRoot, path)
        mkdirSync(resolve(destination, '..'), { recursive: true })
        writeFileSync(destination, path === '/index.html' ? '<title>Public fixture</title>' : 'SYNTHETIC_FIXTURE')
      }
      const configPath = profile === 'target' ? 'Caddyfile.example' : 'Caddyfile.split-domain-rollback.example'
      let config = readFileSync(resolve(import.meta.dirname, '../deploy/yandex', configPath), 'utf8')
      for (const [index, host] of [...hosts, 'www.anomaly-detector.ru', 'api.anomaly-detector.ru'].entries()) {
        config = config.replace(`${host} {`, `http://:${8080 + index} {`)
      }
      writeFileSync(join(root, 'Caddyfile'), `{\n admin off\n auto_https off\n}\n${config}`)
      container = basename(root).toLowerCase()
      docker([
        'run', '--detach', '--name', container, '--pull=never', '--read-only', '--cap-drop=ALL',
        '--cap-add=NET_BIND_SERVICE',
        '--security-opt=no-new-privileges', '--tmpfs', '/data', '--tmpfs', '/config',
        '--publish', '127.0.0.1::8080', '--publish', '127.0.0.1::8081', '--publish', '127.0.0.1::8082',
        '--mount', `type=bind,source=${root},target=/fixture,readonly`,
        '--env', 'ANOMALY_WEBSITE_ROOT=/fixture/public', '--env', 'ANOMALY_WEBAPP_ROOT=/fixture/public',
        '--env', 'ANOMALY_ADMIN_ROOT=/fixture/public', '--env', 'ANOMALY_ADMIN_USER=fixture',
        '--env', `ANOMALY_ADMIN_PASSWORD_HASH=${Bun.password.hashSync('synthetic-static-test', { algorithm: 'bcrypt', cost: 4 })}`,
        image, 'caddy', 'run', '--config', '/fixture/Caddyfile', '--adapter', 'caddyfile',
      ])
      try {
        for (const [index, host] of hosts.entries()) origins[host] = `http://${docker(['port', container, `${8080 + index}/tcp`])}`
      } catch (error) {
        const logs = spawnSync('docker', ['logs', container], { encoding: 'utf8', env: dockerEnvironment })
        console.error(logs.stdout, logs.stderr)
        throw error
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          if ((await fetch(origins[hosts[0]])).status === 200) return
        } catch { /* Wait only for this invocation's isolated server. */ }
        await Bun.sleep(100)
      }
      throw new Error('Isolated Caddy did not become ready')
    }, 30_000)
    afterAll(() => {
      try { if (container) docker(['rm', '--force', container]) }
      finally { if (root) rmSync(root, { recursive: true, force: true }) }
    })

    test('refuses existing and absent private paths before file serving and SPA fallback', async () => {
      const surfaces = profile === 'target' ? hosts : [hosts[0], hosts[2]]
      for (const host of surfaces) {
        for (const path of blocked) {
          for (const method of ['GET', 'HEAD']) {
            const response = await fetch(`${origins[host]}${path}`, {
              method, redirect: 'manual', headers: host === hosts[2] ? { Authorization: credentials } : {},
            })
            expect({ host, path, method, status: response.status }).toEqual({ host, path, method, status: 404 })
            expect(await response.text()).not.toContain('SYNTHETIC_FIXTURE')
          }
        }
      }
    })

    test('preserves public assets, well-known resources, SPA navigation and operator authentication', async () => {
      for (const host of profile === 'target' ? hosts.slice(0, 2) : hosts.slice(0, 1)) {
        for (const path of ['/assets/app.js', '/.well-known/security.txt', '/.well-known/acme-challenge/fixture']) {
          expect((await fetch(`${origins[host]}${path}`)).status).toBe(200)
        }
      }
      const player = profile === 'target' ? hosts[1] : hosts[0]
      const response = await fetch(`${origins[player]}/rooms/example`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('<title>Public fixture</title>')
      expect((await fetch(origins[hosts[2]], { redirect: 'manual' })).status).toBe(401)
      expect((await fetch(origins[hosts[2]], { headers: { Authorization: credentials } })).status).toBe(200)
      if (profile === 'target') expect((await fetch(`${origins[hosts[0]]}/not-a-page`)).status).toBe(404)
      else expect((await fetch(`${origins[hosts[1]]}/rooms/example`, { redirect: 'manual' })).status).toBe(302)
    })
  })
}
