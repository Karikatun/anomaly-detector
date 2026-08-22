import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, registerBrowserUser, test } from '../helpers/test'

const uxAuditDirectory = process.env.UX_AUDIT_DIR

test('keeps feedback voluntary and submits only approved fields with a copyable receipt', async ({ page }) => {
  await registerBrowserUser(page, 'Автор обращения', 'feedback')

  const feedbackMenu = page.getByRole('button', { name: 'СООБЩИТЬ О ПРОБЛЕМЕ ИЛИ ИДЕЕ' })
  await expect(feedbackMenu).toBeVisible()
  await feedbackMenu.click()
  await expect(page).toHaveURL('/feedback')
  await expect(page.getByRole('heading', { name: 'ОБРАТНАЯ СВЯЗЬ' })).toBeVisible()
  await expect(page.getByText('Не отправляйте секреты и лишние личные данные')).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  await expect(page.getByLabel('Адрес для ответа')).toHaveCount(0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await auditCheckpoint(page, 'feedback-desktop')
  await page.setViewportSize({ width: 1024, height: 768 })
  await auditCheckpoint(page, 'feedback-tablet')
  await page.setViewportSize({ width: 390, height: 844 })
  await auditCheckpoint(page, 'feedback-mobile')

  await page.getByRole('button', { name: 'Отложить и вернуться в игру' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ' })).toBeVisible()

  await page.getByRole('button', { name: 'СООБЩИТЬ О ПРОБЛЕМЕ ИЛИ ИДЕЕ' }).click()
  await page.getByRole('button', { name: 'Предложение' }).click()
  await page.getByRole('button', { name: 'Отправить обращение' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Заполните обязательные поля и проверьте адрес для ответа.',
  )

  const desiredChange = 'Добавить краткую подсказку перед первым ходом.'
  const problemSolved = 'Новому игроку будет проще понять цель раунда.'
  await page.getByLabel('Что вы предлагаете изменить').fill(desiredChange)
  await page.getByLabel('Какую проблему это решит').fill(problemSolved)
  await page.getByRole('checkbox', { name: 'Разрешить команде ответить на отдельный адрес' }).check()
  const replyEmail = page.getByLabel('Адрес для ответа')
  await expect(replyEmail).toHaveValue('')
  await replyEmail.fill('feedback-player@example.com')
  await page.getByRole('checkbox', {
    name: 'Разрешить связать обращение с моим аккаунтом для диагностики',
  }).check()

  let submittedBody: Record<string, unknown> | undefined
  page.on('request', (request) => {
    if (request.url().endsWith('/api/feedback') && request.method() === 'POST') {
      submittedBody = request.postDataJSON() as Record<string, unknown>
    }
  })
  await page.getByRole('button', { name: 'Отправить обращение' }).click()

  await expect(page.getByRole('heading', { name: 'ОБРАЩЕНИЕ ПРИНЯТО' })).toBeVisible()
  const publicNumber = page.locator('code').filter({ hasText: /^FB-/ })
  await expect(publicNumber).toHaveText(/^FB-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/)
  await expect(page.getByRole('button', { name: 'Скопировать номер' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('feedback-player@example.com')
  await expect(page.locator('body')).not.toContainText(desiredChange)

  expect(submittedBody).toMatchObject({
    category: 'suggestion',
    desiredChange,
    linkAccount: true,
    problemSolved,
    replyEmail: 'feedback-player@example.com',
    technicalContext: {
      browserClass: 'chromium',
      buildSha: 'e'.repeat(40),
      deviceClass: 'mobile',
      errorId: null,
      routeTemplate: '/',
    },
  })
  expect(JSON.stringify(submittedBody)).not.toMatch(/fullUrl|ipAddress|rawLogs|cookies|tenderState|userAgent/i)

  await auditCheckpoint(page, 'feedback-receipt-mobile')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Скопировать номер' }).click()
  await expect(page.getByRole('status')).toHaveText('Номер скопирован.')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(await publicNumber.textContent())

  await page.getByRole('button', { name: 'Вернуться в меню' }).click()
  await expect(page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ' })).toBeVisible()
})

async function auditCheckpoint(page: Page, name: string) {
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
  }))
  await page.locator('[data-agentation-root]').evaluateAll((elements) => {
    for (const element of elements) {
      if (element instanceof HTMLElement) element.hidden = true
    }
  })
  if (uxAuditDirectory) {
    const outputDirectory = resolve(uxAuditDirectory)
    await mkdir(outputDirectory, { recursive: true })
    await page.screenshot({ path: resolve(outputDirectory, `${name}.viewport.png`) })
    await page.screenshot({ path: resolve(outputDirectory, `${name}.full.png`), fullPage: true })
  }
  const result = await new AxeBuilder({ page })
    .exclude('[data-agentation-root]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(result.violations.map((violation) => ({
    id: violation.id,
    targets: violation.nodes.map((node) => node.target),
  }))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
