import { e2ePassword, expect, registerBrowserUser, test } from '../helpers/test'

test('opens login and registration forms from the anonymous choice screen', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Регистрация', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Яндекс ID' })).toHaveCount(0)
  await expect(page.getByLabel('Логин')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Правила' })).toBeVisible()
  await expect(page.getByText('Пользовательское соглашение', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Правила' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const conceptRules = page.getByRole('button', { name: 'Основная концепция игры' })
  const generalRules = page.getByRole('button', { name: 'Общие правила' })
  const laboratoryRules = page.getByRole('button', { name: 'Как трактовать лабораторные анализы' })
  const closeRules = page.getByRole('button', { name: 'Закрыть правила' })
  await expect(conceptRules).toHaveAttribute('aria-expanded', 'true')
  await expect(laboratoryRules).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('Источник и приёмник нельзя менять местами при трактовке результата.')).toBeHidden()
  await generalRules.press('Enter')
  await expect(generalRules).toHaveAttribute('aria-expanded', 'true')
  await laboratoryRules.click()
  await expect(conceptRules).toHaveAttribute('aria-expanded', 'true')
  await expect(laboratoryRules).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Источник и приёмник нельзя менять местами при трактовке результата.')).toBeVisible()
  await page.getByText('Приватное измерение Непрерывного опыта сообщает только').scrollIntoViewIfNeeded()
  await expect(closeRules).toBeInViewport()
  await closeRules.click()

  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByLabel('Логин')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Яндекс ID' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()

  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  await expect(page.getByLabel('Имя')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Яндекс ID' })).toBeVisible()
})

test('requires privacy consent and shows a non-blocking 16+ registration notice', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  await page.getByLabel('Имя').fill('Ян')
  await page.getByLabel('Логин').fill('explicit-consent')
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)

  const submit = page.getByRole('button', { name: 'Регистрация', exact: true })
  const privacyConsent = page.getByRole('checkbox', { name: 'Я согласен на обработку персональных данных' })

  await expect(page.getByRole('checkbox', { name: 'Мне исполнилось 16 лет' })).toHaveCount(0)
  await expect(page.getByText('Игра имеет возрастную маркировку 16+.')).toBeVisible()
  await expect(submit).toBeDisabled()
  await privacyConsent.check()
  await expect(submit).toBeEnabled()
})

test('shows and hides the password in login and registration modes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()

  const password = page.locator('#auth-password')
  await expect(password).toHaveAttribute('type', 'password')

  await page.getByRole('button', { name: 'Показать пароль' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Скрыть пароль' }).click()
  await expect(password).toHaveAttribute('type', 'password')

  await page.getByRole('button', { name: 'Назад' }).click()
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Показать пароль' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Скрыть пароль' }).click()
  await expect(password).toHaveAttribute('type', 'password')
})

test('registers, restores the browser session, opens the profile, and logs out', async ({ page }) => {
  const { login } = await registerBrowserUser(page, 'Пользователь E2E', 'auth')

  await page.reload()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        (cookie) => cookie.name === 'anomaly_detector_refresh' && cookie.httpOnly,
      ),
    )
    .toBe(true)

  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(page.getByRole('heading', { name: 'ПРОФИЛЬ' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Пользователь E2E' })).toBeVisible()
  await expect(page.getByText(login)).toHaveCount(0)
  await expect(page.getByText('Завершите первый матч, чтобы появилась статистика.')).toBeVisible()

  await page.getByRole('button', { name: 'Назад' }).click()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()

  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
})

test('shows a neutral retry window after five failed password attempts', async ({ page }) => {
  const { login } = await registerBrowserUser(page, 'Лимит входа E2E', 'login-limit')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill('wrong-password')

  for (let index = 0; index < 6; index += 1) {
    const response = page.waitForResponse((candidate) =>
      candidate.url().endsWith('/api/auth/login') && candidate.request().method() === 'POST')
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await response
  }

  await expect(page.getByRole('alert')).toContainText(
    'Подождите от одной до пятнадцати минут',
  )
})

test('uses the configured API transport when OAuth is unavailable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()

  const oauthButton = page.getByRole('button', { name: 'Яндекс ID' })
  await oauthButton.click()

  await expect(page.getByText('Ошибка сервера. Попробуйте позже.')).toBeVisible()
  await expect(page.getByText('Не удалось связаться с сервером. OAuth работает только с localhost.')).toHaveCount(0)
})

test('opens the Rules Reference from the authenticated home page', async ({ page }) => {
  await registerBrowserUser(page, 'Правила E2E', 'rules-home')

  await expect(page.getByText('Правила E2E', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Правила' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Справочник правил' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Детальные правила по фазам' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Закрыть правила' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть правила' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('shows a retryable session error when bootstrap refresh fails transiently', async ({ page }) => {
  await registerBrowserUser(page, 'Восстановление E2E', 'session-retry')
  await page.route('**/api/auth/refresh', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Временная ошибка сессии' } }),
    })
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Проверка сессии временно недоступна' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeHidden()

  await page.unroute('**/api/auth/refresh')
  await page.getByRole('button', { name: 'Попробовать снова' }).click()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
})

test('keeps the authenticated menu and allows retry when logout fails', async ({ page }) => {
  await registerBrowserUser(page, 'Выход E2E', 'logout-retry')
  let shouldFail = true
  await page.route('**/api/auth/logout', async (route) => {
    if (shouldFail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Временная ошибка выхода' } }),
      })
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось выйти')
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()

  shouldFail = false
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})

test('keeps profile input and exposes server errors until a successful retry', async ({ page }) => {
  await registerBrowserUser(page, 'Профиль E2E', 'profile-retry')
  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await page.getByRole('button', { name: 'Редактировать имя' }).click()

  const name = page.getByLabel('Отображаемое имя')
  const save = page.getByRole('button', { name: 'Сохранить' })
  await name.fill('Я')
  await expect(save).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('от 2 до 80')

  let shouldFail = true
  await page.route('**/api/auth/profile', async (route) => {
    if (shouldFail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Профиль временно недоступен' } }),
      })
      return
    }
    await route.continue()
  })

  await name.fill('Новое имя E2E')
  await save.click()
  await expect(page.getByRole('alert')).toContainText('Профиль временно недоступен')
  await expect(name).toHaveValue('Новое имя E2E')

  shouldFail = false
  await save.click()
  await expect(page.getByRole('heading', { name: 'Новое имя E2E' })).toBeVisible()
})
