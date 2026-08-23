import { beforeAll, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const websiteRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const publicWebsiteUrl = 'https://anomaly-detector.ru'
const publicWebappUrl = 'https://app.anomaly-detector.ru'

let html = ''
let robots = ''
let sitemap = ''

beforeAll(async () => {
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: websiteRoot,
    env: {
      ...process.env,
      PUBLIC_WEBSITE_URL: publicWebsiteUrl,
      PUBLIC_WEBAPP_URL: publicWebappUrl,
    },
    encoding: 'utf8',
  })
  expect(build.status, build.stderr).toBe(0)

  html = await readFile(resolve(websiteRoot, 'dist/index.html'), 'utf8')
  robots = await readFile(resolve(websiteRoot, 'dist/robots.txt'), 'utf8')
  sitemap = await readFile(resolve(websiteRoot, 'dist/sitemap.xml'), 'utf8')
})

test('publishes the approved landing and a bounded tutorial continuation in initial HTML', () => {
  expect(html).toMatch(/<h1[^>]*>Разгадайте аномалию раньше соперников<\/h1>/)
  expect(html).toContain(`${publicWebappUrl}/?continue=tutorial`)
  expect(html).toContain('Ограниченная Мощность')
  expect(html).toContain('От обучения к частному Тендеру')
  expect(html).toContain('Частые вопросы')
  expect(html.match(/<img /g)).toHaveLength(3)
  expect(html).not.toContain('Утверждённый прототип')
  expect(html).not.toContain('№1')
  expect(html).not.toContain('Разрешить аналитику')
  expect(html).not.toContain('data-analytics-consent')
})

test('renders an equal-choice first-party consent panel only when explicitly enabled', async () => {
  const analyticsApiUrl = 'https://api.anomaly-detector.ru'
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: websiteRoot,
    env: {
      ...process.env,
      PUBLIC_ANALYTICS_API_URL: analyticsApiUrl,
      PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST: 'launch_ru',
      PUBLIC_WEBSITE_URL: publicWebsiteUrl,
      PUBLIC_WEBAPP_URL: publicWebappUrl,
    },
    encoding: 'utf8',
  })
  expect(build.status, build.stderr).toBe(0)
  const enabledHtml = await readFile(resolve(websiteRoot, 'dist/index.html'), 'utf8')

  expect(enabledHtml).toContain('data-analytics-consent')
  expect(enabledHtml).toContain('Разрешить аналитику')
  expect(enabledHtml).toContain('Только необходимые')
  expect(enabledHtml).toContain(`data-api-url="${analyticsApiUrl}"`)
  expect(enabledHtml).not.toMatch(/google-analytics|googletagmanager|mc\.yandex|metrika|session.?replay/i)
})

test('publishes canonical social and structured product metadata without invented proof', () => {
  expect(html).toContain(`<link rel="canonical" href="${publicWebsiteUrl}/">`)
  expect(html).toContain('<meta property="og:image" content="https://anomaly-detector.ru/')
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
  expect(html).toContain('<script type="application/ld+json">')
  expect(html).toContain('"@type":"VideoGame"')
  expect(html).toContain('"@type":"WebApplication"')
  expect(html).toContain('"@type":"FAQPage"')
  expect(html).not.toContain('aggregateRating')
  expect(html).not.toContain('"review":')
})

test('indexes only the public root and explicitly allows supported search and AI crawlers', () => {
  expect(sitemap).toContain(`<loc>${publicWebsiteUrl}/</loc>`)
  expect(sitemap).not.toContain('app.anomaly-detector.ru')
  for (const agent of [
    'Googlebot',
    'Yandex',
    'OAI-SearchBot',
    'GPTBot',
    'ClaudeBot',
    'Claude-SearchBot',
    'PerplexityBot',
  ]) {
    expect(robots).toContain(`User-agent: ${agent}\nAllow: /`)
  }
  expect(robots).toContain(`Sitemap: ${publicWebsiteUrl}/sitemap.xml`)
})
