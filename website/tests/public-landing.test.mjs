import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const websiteRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const publicWebsiteUrl = 'https://anomaly-detector.ru'
const publicWebappUrl = 'https://app.anomaly-detector.ru'
const buildOutput = mkdtempSync(join(tmpdir(), 'anomaly-website-test-'))
const recoveryAnswer = 'Для аккаунта с паролем доступ можно восстановить через активную почту восстановления или сохранённый резервный код. Для аккаунта Яндекс ID вход и восстановление выполняются на стороне Яндекса.'
const socialImageAlt = 'Экран Разведки Anomaly Detector: выбор сигналов, игроки и Рабочая модель'

let html = ''
let robots = ''
let sitemap = ''

const buildEnvironment = ({ analyticsApiUrl, campaignAllowlist, analyticsMode } = {}) => {
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
  if (analyticsApiUrl) env.PUBLIC_ANALYTICS_API_URL = analyticsApiUrl
  if (campaignAllowlist) env.PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST = campaignAllowlist
  if (analyticsMode) env.PUBLIC_ANALYTICS_MODE = analyticsMode
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
  expect(html.match(/<img /g)).toHaveLength(3)
  expect(html).not.toContain('Утверждённый прототип')
  expect(html).not.toContain('№1')
  expect(html).not.toContain('Разрешить аналитику')
  expect(html).not.toContain('data-analytics-consent')
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

test('renders an equal-choice first-party consent panel only when explicitly enabled', async () => {
  const analyticsApiUrl = 'https://api.anomaly-detector.ru'
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: websiteRoot,
    env: buildEnvironment({ analyticsApiUrl, campaignAllowlist: 'launch_ru', analyticsMode: 'consented' }),
    encoding: 'utf8',
  })
  expect(build.status, build.stderr).toBe(0)
  const enabledHtml = await readFile(resolve(buildOutput, 'index.html'), 'utf8')

  expect(enabledHtml).toContain('data-analytics-consent')
  expect(enabledHtml).toContain('Разрешить аналитику')
  expect(enabledHtml).toContain('Только необходимые')
  expect(enabledHtml).toContain('от публичного лендинга до обучения')
  expect(enabledHtml).not.toContain('от landing до обучения')
  expect(enabledHtml).toContain(`data-api-url="${analyticsApiUrl}"`)
  expect(enabledHtml).not.toMatch(/google-analytics|googletagmanager|mc\.yandex|metrika|session.?replay/i)
})

test('releases only an anonymous counter without a consent panel or analytics identifier', async () => {
  const build = spawnSync('bun', ['run', 'build:release:analytics'], {
    cwd: websiteRoot,
    env: buildEnvironment({
      analyticsApiUrl: 'https://api.anomaly-detector.ru',
      campaignAllowlist: 'ad_01,ad_02,ad_03,ad_04,ad_05,ad_06',
      analyticsMode: 'aggregate',
    }),
    encoding: 'utf8',
  })
  expect(build.status, build.stderr).toBe(0)
  const enabledHtml = await readFile(resolve(buildOutput, 'index.html'), 'utf8')
  expect(enabledHtml).toContain('data-analytics-counter')
  expect(enabledHtml).toContain('data-analytics-event="tutorial_cta"')
  expect(enabledHtml).not.toContain('data-analytics-consent')
  expect(enabledHtml).not.toContain('Разрешить аналитику')
  expect(enabledHtml).not.toContain('Только необходимые')
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
