import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import { createPrisma } from '../../../backend/src/db'
import {
  derivePasswordResetToken,
} from '../../../backend/src/modules/mail'
import { defaultDatabaseUrl, defaultE2eJwtSecret } from '../env'
import { expect, nextE2eClientIp, registerBrowserUser, test } from '../helpers/test'
import { passwordRecoveryRecipient } from '../password-recovery-isolation'

// Passwords and the one-time token must never enter screenshots, traces, or video artifacts.
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

test('requests a generic link, resets once, rejects the old session, and requires sign-in', async ({
  browser,
  page,
}) => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? defaultDatabaseUrl
  const prisma = createPrisma(databaseUrl)
  const recoveryContext = await browser.newContext({
    extraHTTPHeaders: { 'x-e2e-client-ip': nextE2eClientIp() },
  })
  const recoveryPage = await recoveryContext.newPage()
  const unexpectedOrigins: string[] = []
  let analyticsRequests = 0
  const allowedOrigins = new Set([
    new URL(process.env.E2E_WEB_URL!).origin,
    new URL(process.env.E2E_BACKEND_URL!).origin,
  ])
  recoveryPage.on('request', (request) => {
    const origin = new URL(request.url()).origin
    if (!allowedOrigins.has(origin)) unexpectedOrigins.push(origin)
    if (new URL(request.url()).pathname.startsWith('/api/analytics/')) analyticsRequests += 1
  })

  try {
    const { login } = await registerBrowserUser(page, 'Email link recovery', 'password-link')
    const recipient = passwordRecoveryRecipient(login)
    const user = await prisma.user.findUniqueOrThrow({ where: { login }, select: { id: true } })
    await prisma.recoveryEmailBinding.create({
      data: {
        activatesAt: new Date(Date.now() - 60_000),
        cancellationSessionIds: [],
        canonicalKey: recipient,
        policyVersion: 1,
        providerId: 'vk_mail',
        providerValue: recipient,
        requestedAt: new Date(Date.now() - 86_400_000),
        userId: user.id,
      },
    })

    const documentResponse = await recoveryPage.goto('/recover/password')
    expect(documentResponse?.headers()['referrer-policy']).toBe('no-referrer')
    await expect(recoveryPage.locator('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    )
    await expect(recoveryPage.getByRole('heading', { name: 'Восстановление пароля' }))
      .toBeVisible()
    await expectNoAxeViolations(recoveryPage)
    const loginInput = recoveryPage.getByLabel('Логин')
    const requestButton = recoveryPage.getByRole('button', {
      name: 'Отправить ссылку для восстановления',
    })
    await recoveryPage.keyboard.press('Tab')
    await expect(loginInput).toBeFocused()
    await recoveryPage.keyboard.press('Tab')
    await expect(requestButton).toBeFocused()
    await loginInput.fill(login)
    const requestResponse = recoveryPage.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/auth/password-recovery/request'
    ))
    await requestButton.click()
    expect((await requestResponse).status()).toBe(200)
    await expect(recoveryPage.getByRole('status')).toContainText('Запрос принят')

    const message = await prisma.mailOutboxMessage.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      where: { recipient, templateKind: 'password_recovery' },
    })
    const token = derivePasswordResetToken(
      process.env.JWT_SECRET ?? defaultE2eJwtSecret,
      message.messageId,
    )
    await recoveryPage.evaluate((value) => {
      window.location.hash = `token=${value}`
    }, token)
    await expect.poll(() => new URL(recoveryPage.url()).hash === '').toBe(true)
    await expect(recoveryPage).toHaveURL(/\/recover\/password$/)
    await expect(recoveryPage.getByRole('heading', { name: 'Новый пароль' })).toBeVisible()
    expect(await pageContains(recoveryPage, token)).toBe(false)
    expect(analyticsRequests).toBe(0)
    expect(await prisma.passwordResetCredential.count({ where: { userId: user.id } })).toBe(1)
    await expectNoAxeViolations(recoveryPage)

    const newPassword = 'new-password-123'
    const newPasswordInput = recoveryPage.locator('#password-recovery-new-password')
    const confirmPasswordInput = recoveryPage.locator('#password-recovery-confirm-password')
    const completeButton = recoveryPage.getByRole('button', { name: 'Сохранить новый пароль' })
    await newPasswordInput.focus()
    await recoveryPage.keyboard.press('Tab')
    await expect(confirmPasswordInput).toBeFocused()
    await recoveryPage.keyboard.press('Tab')
    await expect(completeButton).toBeFocused()
    await newPasswordInput.fill(newPassword)
    await confirmPasswordInput.fill(newPassword)
    await completeButton.click()
    await expect(recoveryPage.getByRole('status')).toContainText('Пароль изменён')
    await expect(recoveryPage.getByRole('link', { name: 'Войти с новым паролем' }))
      .toBeVisible()
    expect(await pageContains(recoveryPage, token)).toBe(false)
    expect(await prisma.passwordResetCredential.count({ where: { userId: user.id } })).toBe(0)
    expect(await prisma.authSession.count({
      where: { revokedAt: null, userId: user.id },
    })).toBe(0)

    await page.goto('/profile')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()

    await recoveryPage.getByRole('link', { name: 'Войти с новым паролем' }).click()
    await recoveryPage.getByLabel('Логин').fill(login)
    await recoveryPage.getByLabel('Пароль', { exact: true }).fill(newPassword)
    await recoveryPage.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(recoveryPage.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
    expect(unexpectedOrigins).toEqual([])
  } finally {
    await recoveryContext.close()
    await prisma.$disconnect()
  }
})

async function expectNoAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .exclude('[data-agentation-root]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }))).toEqual([])
}

function pageContains(page: Page, value: string) {
  return page.locator('body').evaluate((body, candidate) =>
    body.textContent?.includes(candidate) === true, value)
}
