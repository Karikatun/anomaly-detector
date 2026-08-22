import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import { createPrisma, type DbClient } from '../../../backend/src/db'
import { derivePasswordResetToken } from '../../../backend/src/modules/mail'
import { defaultDatabaseUrl, defaultE2eJwtSecret } from '../env'
import { expect, registerBrowserUser, test } from '../helpers/test'

// Passwords and the one-time token must never enter screenshots, traces, or video artifacts.
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

test('requests a generic link, resets once, rejects the old session, and requires sign-in', async ({
  browser,
  page,
}) => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? defaultDatabaseUrl
  const prisma = createPrisma(databaseUrl)
  const recoveryContext = await browser.newContext({
    extraHTTPHeaders: { 'x-e2e-client-ip': '198.18.20.40' },
  })
  const recoveryPage = await recoveryContext.newPage()
  const unexpectedOrigins: string[] = []
  const allowedOrigins = new Set([
    new URL(process.env.E2E_WEB_URL!).origin,
    new URL(process.env.E2E_BACKEND_URL!).origin,
  ])
  recoveryPage.on('request', (request) => {
    const origin = new URL(request.url()).origin
    if (!allowedOrigins.has(origin)) unexpectedOrigins.push(origin)
  })

  try {
    const { login } = await registerBrowserUser(page, 'Email link recovery', 'password-link')
    const user = await prisma.user.findUniqueOrThrow({ where: { login }, select: { id: true } })
    await seedApprovedMailService(prisma, 'mail.ru')
    await prisma.recoveryEmailBinding.create({
      data: {
        activatesAt: new Date(Date.now() - 60_000),
        cancellationSessionIds: [],
        canonicalKey: `${login}@mail.ru`,
        policyVersion: 1,
        providerValue: `${login}@mail.ru`,
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
      where: { templateKind: 'password_recovery' },
    })
    const token = derivePasswordResetToken(
      process.env.JWT_SECRET ?? defaultE2eJwtSecret,
      message.messageId,
    )
    await recoveryPage.goto(`/recover/password#token=${token}`)
    await expect(recoveryPage).toHaveURL(/\/recover\/password$/)
    await expect(recoveryPage.getByRole('heading', { name: 'Новый пароль' })).toBeVisible()
    await expect(recoveryPage.locator('body')).not.toContainText(token)
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
    await expect(recoveryPage.locator('body')).not.toContainText(token)
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

async function seedApprovedMailService(prisma: DbClient, emailDomain: string) {
  const sourceImport = await prisma.mailRegistryImport.create({
    data: {
      actorId: crypto.randomUUID(),
      addedDomains: [emailDomain],
      checksum: 'b'.repeat(64),
      outcome: 'succeeded',
      removedDomains: [],
      sourceDate: '2026-08-23',
      sourceUrl: 'https://example.test/e2e-registry.xml',
      unchangedCount: 0,
    },
  })
  const candidate = await prisma.mailRegistryCandidate.create({
    data: {
      evidence: 'service_description_mentions_mail',
      importId: sourceImport.id,
      registryEntryId: `e2e-${crypto.randomUUID()}`,
      serviceDomain: emailDomain,
    },
  })
  const latest = await prisma.mailPolicyVersion.findFirst({ orderBy: { version: 'desc' } })
  await prisma.mailPolicyVersion.create({
    data: {
      publishedBy: crypto.randomUUID(),
      version: (latest?.version ?? 0) + 1,
      entries: {
        create: {
          emailDomain,
          ignoreDots: false,
          localPartCaseInsensitive: true,
          sourceCandidateId: candidate.id,
          state: 'approved',
          stripPlusTag: false,
        },
      },
    },
  })
}
