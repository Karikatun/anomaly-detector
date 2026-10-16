import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'

const websiteRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const publicWebsiteUrl = 'https://anomaly-detector.ru'
const publicWebappUrl = 'https://app.anomaly-detector.ru'
const buildOutput = mkdtempSync(join(tmpdir(), 'anomaly-website-test-'))
const recoveryAnswer = 'Для аккаунта с паролем доступ можно восстановить через активную почту восстановления или сохранённый резервный код. Для аккаунта Яндекс ID вход и восстановление выполняются на стороне Яндекса.'
const socialImageAlt = 'Экран Разведки Anomaly Detector: выбор сигналов, игроки и Рабочая модель'

let html = ''
let robots = ''
let sitemap = ''

const buildEnvironment = ({ analyticsApiUrl, campaignAllowlist, analyticsMode, metrikaCounterId } = {}) => {
  const env = {
    ...process.env,
    PUBLIC_WEBSITE_URL: publicWebsiteUrl,
    PUBLIC_WEBAPP_URL: publicWebappUrl,
    SPLIT_DOMAIN_BUILD_OUT_DIR: buildOutput,
  }
  delete env.WEBSITE_RELEASE_BUILD
  delete env.PUBLIC_ANALYTICS_API_URL
  delete env.PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST
  delete env.PUBLIC_ANALYTICS_MODE
  delete env.PUBLIC_METRIKA_COUNTER_ID
  if (analyticsApiUrl) env.PUBLIC_ANALYTICS_API_URL = analyticsApiUrl
  if (campaignAllowlist) env.PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST = campaignAllowlist
  if (analyticsMode) env.PUBLIC_ANALYTICS_MODE = analyticsMode
  if (metrikaCounterId) env.PUBLIC_METRIKA_COUNTER_ID = metrikaCounterId
  return env
}

beforeAll(async () => {
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: websiteRoot,
    env: buildEnvironment(),
    encoding: 'utf8',
  })
  expect(build.status, build.stderr).toBe(0)

  html = await readFile(resolve(buildOutput, 'index.html'), 'utf8')
  robots = await readFile(resolve(buildOutput, 'robots.txt'), 'utf8')
  sitemap = await readFile(resolve(buildOutput, 'sitemap.xml'), 'utf8')
})

afterAll(() => {
  rmSync(buildOutput, { force: true, recursive: true })
})

test('publishes solo bot play and a direct guest tutorial entry in initial HTML', () => {
  expect(html).toMatch(/<h1[^>]*>Разгадайте аномалию раньше соперников<\/h1>/)
  expect(html).toContain(`${publicWebappUrl}/learn`)
  expect(html).not.toContain('?continue=tutorial')
  expect(html).toContain('Без регистрации')
  expect(html).toContain('в одиночку против ботов')
  expect(html).not.toContain('для 2–4 друзей')
  expect(html).toContain('"playMode":["SinglePlayer","MultiPlayer"]')
  expect(html).toContain('"minValue":1')
  expect(html).toContain('Ограниченная Мощность')
  expect(html).toContain('От обучения к первой партии')
  expect(html).toContain('Частые вопросы')
  for (const section of ['how', 'why', 'faq']) {
    expect(html).toContain(`href="#${section}"`)
  }
  expect(html.match(new RegExp(`href="${publicWebappUrl}/learn"`, 'g'))).toHaveLength(3)
  expect(html.match(/<img /g)).toHaveLength(3)
  expect(html).not.toContain('Утверждённый прототип')
  expect(html).not.toContain('№1')
  expect(html).not.toContain('Разрешить аналитику')
  expect(html).not.toContain('data-analytics-consent')
  expect(html).not.toContain('data-metrika-consent')
  expect(html).not.toContain('mc.yandex.ru')
  for (const legalPath of ['/terms', '/privacy', '/personal-data-consent']) {
    expect(html).toContain(`href="${publicWebappUrl}${legalPath}"`)
  }
})

test('uses dedicated portrait game renders for mobile screenshots', async () => {
  const mobileScreens = [...html.matchAll(/<source media="\(max-width: 640px\)" srcset="([^"]+)" width="390" height="(\d+)"/g)]

  expect(mobileScreens).toHaveLength(3)

  for (const [, source, declaredHeight] of mobileScreens) {
    const image = await readFile(resolve(buildOutput, source.slice(1)))
    expect(image.subarray(1, 4).toString()).toBe('PNG')
    const width = image.readUInt32BE(16)
    const height = image.readUInt32BE(20)
    expect(width).toBe(390)
    expect(height).toBe(Number(declaredHeight))
    expect(height).toBeGreaterThan(width)
  }
})

test('explains the first-party path before the proof gallery and links to full images for each layout', async () => {
  const journeyStart = html.indexOf('id="journey-title"')
  const proofStart = html.indexOf('class="a-proof"')
  expect(journeyStart).toBeGreaterThan(0)
  expect(journeyStart).toBeLessThan(proofStart)

  const figures = [...html.matchAll(/<figure class="screen-frame[^"]*"[^>]*>([\s\S]*?)<\/figure>/g)]
  expect(figures).toHaveLength(3)
  for (const figure of figures) {
    const content = figure[1]
    const captionStart = content.search(/<figcaption\b/)
    const pictureStart = content.search(/<picture\b/)
    expect(captionStart).toBeGreaterThanOrEqual(0)
    expect(pictureStart).toBeGreaterThan(captionStart)

    const mobileSource = content.match(/<source media="\(max-width: 640px\)" srcset="([^"]+)"/)?.[1]
    const desktopSource = content.match(/<img src="([^"]+)"/)?.[1]
    expect(mobileSource).toBeDefined()
    expect(desktopSource).toBeDefined()
    for (const [variant, source] of [['mobile', mobileSource], ['desktop', desktopSource]]) {
      expect(content).toContain(`class="full-screen-link full-screen-link-${variant}" href="${source}"`)
      const image = await readFile(resolve(buildOutput, source.slice(1)))
      expect(image.subarray(1, 4).toString()).toBe('PNG')
    }
  }
})

test('keeps the legacy consented configuration inactive without a prompt or linked collector', async () => {
  const analyticsApiUrl = 'https://api.anomaly-detector.ru'
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: websiteRoot,
    env: buildEnvironment({ analyticsApiUrl, campaignAllowlist: 'launch_ru', analyticsMode: 'consented' }),
    encoding: 'utf8',
  })
  expect(build.status, build.stderr).toBe(0)
  const enabledHtml = await readFile(resolve(buildOutput, 'index.html'), 'utf8')

  expect(enabledHtml).not.toContain('data-analytics-consent')
  expect(enabledHtml).not.toContain('Разрешить аналитику')
  expect(enabledHtml).not.toContain('Только необходимые')
  expect(enabledHtml).not.toContain('data-analytics-counter')
  expect(enabledHtml).not.toContain(`data-api-url="${analyticsApiUrl}"`)
  expect(enabledHtml.match(new RegExp(`href="${publicWebappUrl}/learn"`, 'g'))).toHaveLength(3)

  const scriptFiles = (await readdir(resolve(buildOutput, '_astro'))).filter((file) => file.endsWith('.js'))
  const scripts = await Promise.all(scriptFiles.map((file) => readFile(resolve(buildOutput, '_astro', file), 'utf8')))
  const output = [enabledHtml, ...scripts].join('\n')
  expect(output).not.toMatch(/data-analytics-consent|\/api\/analytics\//)
  expect(output).not.toMatch(/google-analytics|googletagmanager|mc\.yandex|metrika|session.?replay/i)
})

test('releases the anonymous counter with an explicit Metrika consent panel', async () => {
  const build = spawnSync('bun', ['run', 'build:release:analytics'], {
    cwd: websiteRoot,
    env: buildEnvironment({
      analyticsApiUrl: 'https://api.anomaly-detector.ru',
      campaignAllowlist: 'ad_01,ad_02,ad_03,ad_04,ad_05,ad_06',
      analyticsMode: 'aggregate',
      metrikaCounterId: '112719766',
    }),
    encoding: 'utf8',
  })
  expect(build.status, build.stderr).toBe(0)
  const enabledHtml = await readFile(resolve(buildOutput, 'index.html'), 'utf8')
  expect(enabledHtml).toContain('data-analytics-counter')
  expect(enabledHtml).toContain('data-analytics-event="tutorial_cta"')
  expect(enabledHtml).toContain('data-analytics-event="login_cta"')
  expect(enabledHtml).toContain('data-metrika-consent')
  expect(enabledHtml).toContain('data-metrika-action="allow"')
  expect(enabledHtml).toContain('localStorage.setItem')
  expect(enabledHtml).toContain('reachGoal')
  expect(enabledHtml).toContain('112719766')
  expect(enabledHtml.match(/<a[^>]+data-analytics-event="tutorial_cta"/g)).toHaveLength(3)

  expect(enabledHtml).not.toContain('data-analytics-consent')
})

test('publishes complete social metadata backed by a real image asset', async () => {
  expect(html).toContain(`<link rel="canonical" href="${publicWebsiteUrl}/">`)
  const imageMatch = html.match(/<meta property="og:image" content="([^"]+)">/)
  expect(imageMatch).not.toBeNull()
  const socialImageUrl = imageMatch?.[1] ?? ''
  expect(socialImageUrl).toStartWith(`${publicWebsiteUrl}/`)
  expect(html).toContain('<meta property="og:image:type" content="image/png">')
  expect(html).toContain('<meta property="og:image:width" content="1440">')
  expect(html).toContain('<meta property="og:image:height" content="900">')
  expect(html).toContain(`<meta property="og:image:alt" content="${socialImageAlt}">`)
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
  expect(html).toContain('<meta name="twitter:title" content="Anomaly Detector — бесплатная браузерная игра на дедукцию">')
  expect(html).toContain('<meta name="twitter:description" content="Бесплатная браузерная игра на дедукцию: исследуйте аномалию с друзьями или в одиночку против ботов. Начните с обучения без регистрации.">')
  expect(html).toContain(`<meta name="twitter:image" content="${socialImageUrl}">`)
  expect(html).toContain(`<meta name="twitter:image:alt" content="${socialImageAlt}">`)

  const imagePath = resolve(buildOutput, new URL(socialImageUrl).pathname.slice(1))
  const image = await readFile(imagePath)
  expect(image.subarray(1, 4).toString()).toBe('PNG')
  expect(image.readUInt32BE(16)).toBe(1440)
  expect(image.readUInt32BE(20)).toBe(900)
})

test('publishes structured product metadata that matches the visible current FAQ', () => {
  expect(html).toContain('<script type="application/ld+json">')
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)
  expect(jsonLdMatch).not.toBeNull()
  const structuredData = JSON.parse(jsonLdMatch?.[1] ?? 'null')
  expect(structuredData.map((item) => item['@type'])).toEqual([
    'VideoGame',
    'WebApplication',
    'FAQPage',
  ])
  const faqPage = structuredData.find((item) => item['@type'] === 'FAQPage')
  const recoveryQuestion = faqPage.mainEntity.find((item) => item.name === 'Как восстановить доступ?')
  expect(recoveryQuestion.acceptedAnswer.text).toBe(recoveryAnswer)
  expect(html.split(recoveryAnswer)).toHaveLength(3)
  expect(html).not.toContain('появится до публичного запуска')
  expect(html).not.toContain('aggregateRating')
  expect(html).not.toContain('"review":')
  expect(html).not.toMatch(/<video\b|autoplay|scroll-reveal/i)
})

test('indexes only the public root and explicitly allows supported search and AI crawlers', () => {
  expect(sitemap).toContain(`<loc>${publicWebsiteUrl}/</loc>`)
  expect(sitemap).not.toContain('app.anomaly-detector.ru')
  for (const agent of [
    'Googlebot',
    'Yandex',
    'OAI-SearchBot',
    'GPTBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-SearchBot',
    'Claude-User',
    'PerplexityBot',
    'Perplexity-User',
  ]) {
    expect(robots).toContain(`User-agent: ${agent}\nAllow: /`)
  }
  expect(robots).toContain(`Sitemap: ${publicWebsiteUrl}/sitemap.xml`)
  expect(sitemap.match(/<loc>/g)).toHaveLength(1)
})


async function metrikaConsentPage(storage) {
  const source = await readFile(resolve(websiteRoot, 'src/components/MetrikaConsent.astro'), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(script)
  const scripts = []
  const commands = []
  const handlers = new Map()
  const goalHandlers = new Map()
  const status = { textContent: '' }
  let reloads = 0
  const buttons = ['allow', 'necessary', 'revoke'].map((action) => ({
    dataset: { metrikaAction: action },
    addEventListener: (_event, handler) => handlers.set(action, handler),
  }))
  const panels = ['allowed', 'necessary', 'undecided'].map((choice) => ({
    dataset: { metrikaPanel: choice }, hidden: false,
  }))
  const root = {
    dataset: { counterId: '112719766' },
    querySelector: () => status,
    querySelectorAll: (selector) => selector === '[data-metrika-panel]' ? panels : buttons,
  }
  const location = { pathname: '/', search: '', hash: '', reload: () => { reloads += 1 } }
  const browserWindow = { ym: (...args) => commands.push(args) }
  runInNewContext(javascript, {
    window: browserWindow,
    localStorage: storage,
    location,
    document: {
      querySelector: () => root,
      querySelectorAll: (selector) => [{ addEventListener: (_event, handler) => goalHandlers.set(selector.includes('login_cta') ? 'login_cta' : 'tutorial_cta', handler) }],
      createElement: () => ({ remove() {} }),
      head: { appendChild: (script) => scripts.push(script) },
    },
  })
  return { scripts, commands, status, panels, click: (action) => handlers.get(action)(), goal: (goal) => goalHandlers.get(goal)(), reloads: () => reloads }
}

test('withdrawal invalidates a prior grant before reload when storage quota prevents writes', async () => {
  const values = new Map([['anomaly-detector:metrika-consent', 'allowed']])
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: () => { throw new DOMException('Synthetic quota exhausted', 'QuotaExceededError') },
    removeItem: (key) => values.delete(key),
  }
  const page = await metrikaConsentPage(storage)
  expect(page.scripts).toHaveLength(1)

  page.click('revoke')

  expect(storage.getItem('anomaly-detector:metrika-consent')).not.toBe('allowed')
  expect(page.reloads()).toBe(1)
  const reloaded = await metrikaConsentPage(storage)
  expect(reloaded.scripts).toHaveLength(0)
  expect(reloaded.commands).toHaveLength(0)
})


test('unavailable storage never reports a saved grant or forces a stale-grant reload', async () => {
  const storage = {
    getItem: () => 'allowed',
    setItem: () => { throw new Error('unavailable') },
    removeItem: () => { throw new Error('unavailable') },
  }
  const page = await metrikaConsentPage(storage)
  page.click('revoke')
  page.goal('tutorial_cta')
  page.goal('login_cta')
  expect(page.reloads()).toBe(0)
  expect(page.commands.map((call) => call[1])).toEqual(['init', 'destruct'])
  expect(page.status.textContent).toContain('Не удалось сохранить выбор')
  page.click('allow')
  expect(page.reloads()).toBe(0)
  expect(page.commands.filter((call) => call[1] === 'init')).toHaveLength(1)
})

test('storage read and grant failures keep the landing usable without loading a counter', async () => {
  const storage = {
    getItem: () => { throw new Error('unavailable') },
    setItem: () => { throw new Error('unavailable') },
    removeItem: () => { throw new Error('unavailable') },
  }
  const page = await metrikaConsentPage(storage)
  page.click('allow')
  expect(page.scripts).toHaveLength(0)
  expect(page.commands).toHaveLength(0)
  expect(page.status.textContent).toContain('Не удалось сохранить выбор')
})

test('landing persists normal grant, refusal and withdrawal choices', async () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  const page = await metrikaConsentPage(storage)
  page.click('necessary')
  expect(storage.getItem('anomaly-detector:metrika-consent')).toBe('necessary')
  expect(page.scripts).toHaveLength(0)
  page.click('allow')
  expect(storage.getItem('anomaly-detector:metrika-consent')).toBe('allowed')
  expect(page.scripts).toHaveLength(1)
  page.click('revoke')
  expect(storage.getItem('anomaly-detector:metrika-consent')).toBe('necessary')
  expect(page.reloads()).toBe(1)
})
