// #56 actual-browser harness. Offline reload uses Playwright in-memory routes;
// it is not a PWA/offline-cache claim and the CPU profile is desktop emulation.
import { chromium, type Browser, type Page } from 'playwright'

type Scenario = 'v2-easy' | 'v2-hard' | 'legacy-v1'
type Profile = Readonly<{ cpuThrottle: number; name: 'desktop' | 'desktop-emulated-4x-cpu' }>
type Result = Readonly<{ policyLatency: Record<string, { calls: number; maxMs: number; totalMs: number }>; reloaded: boolean; ruleset: string; scenario: string; strategyVersion: string }>

const directory = new URL('.', import.meta.url)
const startedAt = performance.now()
const index = await Bun.file(new URL('./index.html', directory)).text()
const cryptoAdapter = new URL('./sha256-adapter.ts', directory).pathname
const buildBrowser = async (entrypoint: string) => {
  const build = await Bun.build({
    entrypoints: [new URL(entrypoint, directory).pathname], format: 'iife', minify: true,
    plugins: [{ name: 'scratch-node-crypto', setup: (builder) => builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: cryptoAdapter })) }], target: 'browser',
  })
  if (!build.success || !build.outputs[0]) throw new Error(build.logs.map((log) => log.message).join('\n'))
  return build.outputs[0].text()
}
const [engine, policy] = await Promise.all([buildBrowser('./engine-entry.ts'), buildBrowser('./policy-measure-entry.ts')])
const server = Bun.serve({
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/' || path === '/index.html') return new Response(index, { headers: { 'content-type': 'text/html' } })
    if (path === '/engine.js') return new Response(engine, { headers: { 'content-type': 'application/javascript' } })
    return new Response('not found', { status: 404 })
  }, hostname: '127.0.0.1', port: Number(process.env.BOTS_OFFLINE_PORT ?? 0),
})
const origin = server.url.toString().replace(/\/$/, '')
const scenarios: readonly Scenario[] = ['v2-easy', 'v2-hard', 'legacy-v1']
const profiles: readonly Profile[] = [{ cpuThrottle: 1, name: 'desktop' }, { cpuThrottle: 4, name: 'desktop-emulated-4x-cpu' }]
const diagnostics: string[] = []
let lastPage: Page | undefined
let browser: Browser | undefined

const bodyResult = async (page: Page): Promise<Result> => {
  const text = await page.locator('body').textContent()
  const payload = text?.split('\n')[1]
  if (!payload) throw new Error('Browser result payload is missing')
  return JSON.parse(payload) as Result
}

const assertGuard = async (saved: unknown, expected: string) => {
  const activeBrowser = browser
  if (!activeBrowser) throw new Error('Chromium is not available')
  const context = await activeBrowser.newContext()
  await context.addInitScript((value) => localStorage.setItem('offline-prototype-transcript', JSON.stringify(value)), saved)
  const page = await context.newPage()
  lastPage = page
  await page.goto(`${origin}/?scenario=v2-easy`)
  await page.waitForFunction(() => document.body.dataset.result === 'guard-failed')
  if (!(await page.locator('body').textContent())?.includes(expected)) throw new Error(`Guard did not reject ${expected}`)
  await context.close()
}

const runScenario = async (profile: Profile, scenario: Scenario) => {
  const activeBrowser = browser
  if (!activeBrowser) throw new Error('Chromium is not available')
  const context = await activeBrowser.newContext()
  const page = await context.newPage()
  lastPage = page
  const cdp = await context.newCDPSession(page)
  if (profile.cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuThrottle })
  const requests: Array<{ method: string; url: string }> = []
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }))
  page.on('console', (message) => diagnostics.push(`console ${message.type()}: ${message.text()}`))
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.stack ?? error.message}`))
  await page.goto(`${origin}/?scenario=${scenario}`)
  await page.waitForFunction(() => document.body.dataset.result === 'checkpoint')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('offline-prototype-transcript') ?? '{}')) as { scenario?: { strategyVersion?: string } }
  if (scenario === 'legacy-v1' && saved.scenario?.strategyVersion !== 'bot-v1') throw new Error('Legacy v1 checkpoint changed strategy version')
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/' || path === '/index.html') return route.fulfill({ body: index, contentType: 'text/html' })
    if (path === '/engine.js') return route.fulfill({ body: engine, contentType: 'application/javascript' })
    return route.abort()
  })
  await context.setOffline(true)
  await page.reload()
  await page.waitForFunction(() => document.body.dataset.result === 'pass')
  const result = await bodyResult(page)
  if (!result.reloaded || result.scenario !== scenario || result.ruleset !== 'tender-v2') throw new Error(`Offline reload did not resume ${scenario}`)
  if (scenario === 'legacy-v1' && result.strategyVersion !== 'bot-v1') throw new Error('Legacy v1 restore changed strategy version')
  if (requests.some((request) => new URL(request.url).origin !== origin || request.url.includes('/api/') || request.method !== 'GET')) throw new Error(`Unexpected network request in ${scenario}`)
  await context.close()
  return { profile: profile.name, requests, result, scenario }
}

try {
  browser = await chromium.launch({ headless: true })
  const results = []
  for (const profile of profiles) for (const scenario of scenarios) results.push(await runScenario(profile, scenario))
  await assertGuard({ events: [], formatVersion: 1, policyLatency: {}, scenario: { difficulty: 'easy', name: 'v2-easy', ruleset: 'tender-v1', strategyVersion: 'bot-v2' } }, 'Unsupported persisted local Tender transcript')
  await assertGuard({ events: [], formatVersion: 1, policyLatency: {}, scenario: { difficulty: 'easy', name: 'v2-easy', ruleset: 'tender-v2', strategyVersion: 'bot-v1' } }, 'Unsupported persisted local Tender transcript')
  await assertGuard({ formatVersion: 999 }, 'Unsupported persisted local Tender transcript')
  const measurement = {
    browser: { name: 'chromium', version: browser.version() },
    bundleBytes: { engine: new TextEncoder().encode(engine).byteLength, policy: new TextEncoder().encode(policy).byteLength },
    cpuProfiles: { desktop: 'desktop Chromium', 'desktop-emulated-4x-cpu': 'CDP CPU throttle rate 4; emulation only, not a physical phone measurement' },
    durationMs: performance.now() - startedAt, localOnly: true, results,
    runtime: { bunVersion: Bun.version, host: { arch: process.arch, platform: process.platform } },
  }
  await Bun.write(new URL('../../../.scratch/bots-offline/browser-result.json', directory), `${JSON.stringify(measurement, null, 2)}\n`)
  console.log(JSON.stringify(measurement, null, 2))
} catch (error) {
  const body = lastPage ? await lastPage.locator('body').textContent().catch(() => undefined) : undefined
  await Bun.write(new URL('../../../.scratch/bots-offline/browser-error.txt', directory), `${error instanceof Error ? error.stack : String(error)}\n${diagnostics.join('\n')}\nbody: ${body ?? ''}\n`)
  throw error
} finally {
  await browser?.close()
  server.stop(true)
}
