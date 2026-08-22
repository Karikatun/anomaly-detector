import { e2ePassword, expect, registerBrowserUser, test } from '../helpers/test'

test('shows the primary sign-in paths immediately and exposes accurate auth headings', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Регистрация', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Яндекс ID' })).toBeVisible()
  await expect(page.getByLabel('Логин')).toBeVisible()
  await expect(page.getByText('Соревновательная игра о научной дедукции для 2–4 игроков.')).toBeVisible()
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

  await page.getByRole('tab', { name: 'Регистрация', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Регистрация', exact: true })).toBeVisible()
  const displayName = page.getByLabel('Имя')
  await expect(displayName).toBeVisible()
  await expect(displayName).toHaveAttribute('maxlength', '20')
  await displayName.fill('Я'.repeat(21))
  await expect(displayName).toHaveValue('Я'.repeat(20))
  await expect(page.getByRole('button', { name: 'Яндекс ID' })).toBeVisible()
})

test('continues a landing registration into tutorial and ignores unknown destinations', async ({ page }) => {
  await page.goto('/?continue=admin')
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toHaveAttribute('aria-selected', 'true')

  const websiteUrl = process.env.E2E_WEBSITE_URL
  const webappUrl = process.env.E2E_WEB_URL
  if (!websiteUrl || !webappUrl) {
    throw new Error('The public website and player webapp origins are required for E2E')
  }
  expect(new URL(websiteUrl).origin).not.toBe(new URL(webappUrl).origin)

  await page.goto(websiteUrl)
  const tutorialLink = page.getByRole('link', { name: 'Пройти обучение' }).first()
  await expect(tutorialLink).toHaveAttribute(
    'href',
    new URL('/?continue=tutorial', webappUrl).toString(),
  )
  await tutorialLink.click()
  await expect(page).toHaveURL(new URL('/?continue=tutorial', webappUrl).toString())
  await expect(page.getByRole('tab', { name: 'Регистрация', exact: true })).toHaveAttribute('aria-selected', 'true')

  const login = `landing-tutorial-${Date.now()}`
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Имя').fill('Исследователь лендинга')
  await page.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' }).check()
  await page.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' }).check()
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()

  await expect(page).toHaveURL('/tutorial')
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию' })).toBeVisible()
})

test('explains how to register when a Yandex ID has no game account', async ({ page }) => {
  await page.goto('/?auth_error=oauth_registration_consent_required')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Создание аккаунта через Яндекс' })).toBeVisible()
  await expect(dialog.getByText(
    'Аккаунт ещё не зарегистрирован. Для продолжения подтвердите обязательные условия создания аккаунта.',
  )).toBeVisible()
  const privacyConsent = dialog.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' })
  const termsAcceptance = dialog.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' })
  const continueButton = dialog.getByRole('button', { name: 'Согласен и продолжить' })
  await expect(privacyConsent).toBeVisible()
  await expect(termsAcceptance).toBeVisible()
  await expect(continueButton).toBeDisabled()
  await privacyConsent.check()
  await expect(continueButton).toBeDisabled()
  await termsAcceptance.check()
  await expect(continueButton).toBeEnabled()
  await expect(page).toHaveURL('/')
})

test('shows a generic Yandex callback failure without exposing its internal cause', async ({ page }) => {
  await page.goto('/?auth_error=oauth_failed')

  await expect(page.getByRole('alert')).toHaveText(
    'Не удалось завершить вход через Яндекс. Попробуйте снова или войдите другим способом.',
  )
  await expect(page).toHaveURL('/')
  await expect(page.locator('body')).not.toContainText('oauth_failed')
})

test('submits registration as a native form when Enter is pressed from any field', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Регистрация', exact: true }).click()

  const login = `native-form-${Date.now()}`
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByLabel('Имя').fill('Нативная форма')
  await page.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' }).check()
  await page.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' }).check()

  await expect(page.locator('form')).toHaveCount(1)
  await page.getByLabel('Имя').press('Enter')

  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
})

test('requires separate personal-data consent and terms acceptance with links to both documents', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Регистрация', exact: true }).click()
  await page.getByLabel('Имя').fill('Ян')
  await page.getByLabel('Логин').fill('explicit-consent')
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)

  const submit = page.getByRole('button', { name: 'Регистрация', exact: true })
  const privacyConsent = page.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' })
  const termsAcceptance = page.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' })

  await expect(page.getByRole('checkbox', { name: 'Мне исполнилось 16 лет' })).toHaveCount(0)
  await expect(page.getByText('Игра имеет возрастную маркировку 16+.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'обработку персональных данных' }))
    .toHaveAttribute('href', '/personal-data-consent')
  await expect(termsAcceptance).toBeVisible()
  await expect(page.getByText('Я принимаю')
    .getByRole('link', { name: 'Пользовательское соглашение' }))
    .toHaveAttribute('href', '/terms')
  await expect(submit).toBeDisabled()
  await privacyConsent.check()
  await expect(submit).toBeDisabled()
  await termsAcceptance.check()
  await expect(submit).toBeEnabled()
})

test('shows and hides the password in login and registration modes', async ({ page }) => {
  await page.goto('/')

  const password = page.locator('#auth-password')
  await expect(password).toHaveAttribute('type', 'password')

  await page.getByRole('button', { name: 'Показать пароль' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Скрыть пароль' }).click()
  await expect(password).toHaveAttribute('type', 'password')

  await page.getByRole('tab', { name: 'Регистрация', exact: true }).click()
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

  await page
    .getByRole('link', { name: 'Открыть профиль пользователя Пользователь E2E' })
    .click()
  await expect(page.getByRole('heading', { name: 'ПРОФИЛЬ', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Пользователь E2E' })).toBeVisible()
  await expect(page.getByText(login)).toHaveCount(0)
  await expect(page.getByText('Завершите первый матч, чтобы появилась статистика.')).toBeVisible()

  await page.getByRole('button', { name: 'Назад' }).click()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()

  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
})

test('does not expose the operator application from the player domain', async ({ page }) => {
  await registerBrowserUser(page, 'Обычный пользователь', 'operations-denied')

  let operationsRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/operations/overview')) operationsRequests += 1
  })
  await page.goto('/system/overview')

  await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible()
  expect(operationsRequests).toBe(0)
  await expect(page.getByRole('navigation')).toHaveCount(0)
})

test('deletes an account from the profile only after confirmation and explains recent sign-in recovery', async ({
  page,
}) => {
  await registerBrowserUser(page, 'Удаляемый профиль', 'delete-account')
  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()

  const openDeletionDialog = page.getByRole('button', { name: 'Удалить аккаунт' })
  await expect(openDeletionDialog).toBeVisible()
  await openDeletionDialog.click()
  const dialog = page.getByRole('dialog', { name: 'Удалить аккаунт?' })
  await expect(dialog).toContainText('История матчей останется только в обезличенном виде.')
  await dialog.getByRole('button', { name: 'Отмена' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'ПРОФИЛЬ', exact: true })).toBeVisible()

  let rejectNextDeletion = true
  await page.route('**/api/auth/account', async (route) => {
    if (route.request().method() === 'DELETE' && rejectNextDeletion) {
      rejectNextDeletion = false
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: 'Recent authentication is required to delete the account',
          },
        }),
      })
      return
    }
    await route.continue()
  })

  await openDeletionDialog.click()
  await dialog.getByRole('button', { name: 'Удалить аккаунт' }).click()
  await expect(dialog.getByRole('alert')).toHaveText(
    'Для удаления аккаунта выйдите, войдите снова и повторите действие в течение 10 минут.',
  )
  await dialog.getByRole('button', { name: 'Отмена' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'ПРОФИЛЬ', exact: true })).toBeVisible()

  await openDeletionDialog.click()
  await dialog.getByRole('button', { name: 'Удалить аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        (cookie) => cookie.name === 'anomaly_detector_refresh',
      ),
    )
    .toBe(false)

  await page.goto('/profile')
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()
})

test('shows a neutral retry window after five failed password attempts', async ({ page }) => {
  const { login } = await registerBrowserUser(page, 'Лимит входа E2E', 'login-limit')
  await page.getByRole('button', { name: 'Выйти' }).click()
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
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible()
})

test('blocks new room actions and allows retry when the active match cannot be checked', async ({ page }) => {
  await registerBrowserUser(page, 'Проверка матча E2E', 'current-match-retry')
  await page.route('**/api/rooms/current', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Временная ошибка матча' } }),
    })
  })

  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Не удалось проверить активный матч')
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' })).toHaveCount(0)

  await page.unroute('**/api/rooms/current')
  await page.getByRole('button', { name: 'Повторить проверку' }).click()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
})

test('keeps profile input and exposes server errors until a successful retry', async ({ page }) => {
  await registerBrowserUser(page, 'Профиль E2E', 'profile-retry')
  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await page.getByRole('button', { name: 'Редактировать имя' }).click()

  const name = page.getByLabel('Отображаемое имя')
  const save = page.getByRole('button', { name: 'Сохранить' })
  await name.fill('Я')
  await expect(save).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('от 2 до 20')

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

test('shows masked Yandex protection and a non-disclosing email conflict state', async ({ page }) => {
  await registerBrowserUser(page, 'Защита E2E', 'yandex-protection')
  let state: 'managed' | 'conflict' = 'managed'
  await page.route('**/api/auth/account-protection', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accountProtection: state === 'managed'
          ? { state: 'yandex_managed', maskedAccountEmail: 'P***@yandex.ru' }
          : { state: 'yandex_conflict' },
      }),
    })
  })

  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(page.getByRole('heading', { name: 'Защита аккаунта' })).toBeVisible()
  await expect(page.getByText('P***@yandex.ru')).toBeVisible()
  await expect(page.getByText('Управляется Яндекс ID')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Player@yandex.ru')

  state = 'conflict'
  await page.reload()
  await expect(page.getByText('Не удалось синхронизировать актуальный адрес.')).toBeVisible()
  await expect(page.getByText('Вход через Яндекс ID продолжает работать.')).toBeVisible()
})

test('keeps Recovery Email optional and completes its protected cooling-off flow', async ({ page }) => {
  await registerBrowserUser(page, 'Восстановление E2E', 'recovery-protection')
  let state: Record<string, unknown> = { state: 'password_unprotected' }
  const mutationBodies: unknown[] = []
  await page.route('**/api/auth/account-protection', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accountProtection: state }),
    })
  })
  await page.route('**/api/auth/account-protection/recovery-email/**', async (route) => {
    mutationBodies.push(route.request().postDataJSON())
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/start')) {
      state = {
        canCancel: true,
        codeExpiresAt: '2030-08-22T15:15:00.000Z',
        maskedAccountEmail: 'p***@mail.ru',
        state: 'password_pending_code',
      }
    } else if (pathname.endsWith('/confirm')) {
      state = {
        activatesAt: '2030-08-23T15:00:00.000Z',
        canCancel: true,
        maskedAccountEmail: 'p***@mail.ru',
        state: 'password_cooling_off',
      }
    } else if (pathname.endsWith('/cancel')) {
      state = { state: 'password_unprotected' }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accountProtection: state }),
    })
  })

  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(page.getByText('Это необязательно: урок и игра доступны без почты.')).toBeVisible()
  await page.getByRole('button', { name: 'Добавить почту' }).click()
  const startDialog = page.getByRole('dialog', { name: 'Добавить почту восстановления' })
  await expect(startDialog).toBeVisible()
  await startDialog.getByLabel('Почта восстановления').fill('postponed@mail.ru')
  await startDialog.getByLabel('Текущий пароль').fill(e2ePassword)
  await startDialog.getByRole('button', { name: 'Сделать позже' }).click()
  await expect(startDialog).toBeHidden()
  await page.getByRole('button', { name: 'Добавить почту' }).click()
  await expect(startDialog.getByLabel('Почта восстановления')).toHaveValue('')
  await expect(startDialog.getByLabel('Текущий пароль')).toHaveValue('')
  await startDialog.getByRole('button', { name: 'Сделать позже' }).click()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()

  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await page.getByRole('button', { name: 'Добавить почту' }).click()
  await page.getByLabel('Почта восстановления').fill('player@mail.ru')
  await page.getByLabel('Текущий пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Отправить код' }).click()
  const codeDialog = page.getByRole('dialog', { name: 'Подтвердить почту' })
  await expect(codeDialog).toBeVisible()
  await expect(codeDialog).toContainText('p***@mail.ru')
  await page.getByLabel('Код из письма').fill('123456')
  await codeDialog.getByRole('button', { name: 'Подтвердить' }).click()

  await expect(page.getByText('Период защиты')).toBeVisible()
  await expect(page.getByText('p***@mail.ru', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('player@mail.ru')
  await expect(page.locator('body')).not.toContainText('123456')
  await page.getByRole('button', { name: 'Отменить привязку' }).click()
  const cancelDialog = page.getByRole('dialog', { name: 'Отменить защиту?' })
  await expect(cancelDialog).toContainText('Сеансы, открытые после запроса, завершатся')
  await cancelDialog.getByRole('button', { name: 'Отменить защиту' }).click()
  await expect(page.getByText('Почта восстановления пока не настроена.')).toBeVisible()
  expect(mutationBodies).toEqual([
    { email: 'player@mail.ru', password: e2ePassword },
    { code: '123456' },
    {},
  ])
})

test('replaces Recovery Email only after both masked factors and supports safe abandonment', async ({ page }) => {
  await registerBrowserUser(page, 'Замена почты E2E', 'recovery-replacement')
  type ProtectionState = Record<string, unknown>
  const replacementState = (
    oldStatus: 'confirmed' | 'pending' = 'pending',
    canManage = true,
  ): ProtectionState => ({
    canManage,
    newAddress: {
      codeExpiresAt: '2030-08-22T15:15:00.000Z',
      maskedAccountEmail: 'N***@mail.ru',
      status: 'pending',
    },
    oldAddress: {
      codeExpiresAt: '2030-08-22T15:15:00.000Z',
      maskedAccountEmail: 'O***@mail.ru',
      status: oldStatus,
    },
    state: 'password_replacing',
  })
  let state: ProtectionState = {
    maskedAccountEmail: 'O***@mail.ru',
    state: 'password_active',
  }
  let replacementRound = 0
  const mutationBodies: unknown[] = []
  await page.route('**/api/auth/account-protection', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accountProtection: state }),
    })
  })
  await page.route(
    '**/api/auth/account-protection/recovery-email/replacement/**',
    async (route) => {
      const pathname = new URL(route.request().url()).pathname
      const body = route.request().postDataJSON()
      mutationBodies.push(body)
      if (pathname.endsWith('/start')) {
        replacementRound += 1
        state = replacementRound === 1
          ? replacementState()
          : {
              canManage: true,
              newAddress: {
                codeExpiresAt: '2030-08-22T15:30:00.000Z',
                maskedAccountEmail: 'T***@mail.ru',
                status: 'pending',
              },
              oldAddress: {
                codeExpiresAt: '2030-08-22T15:30:00.000Z',
                maskedAccountEmail: 'N***@mail.ru',
                status: 'pending',
              },
              state: 'password_replacing',
            }
      } else if (pathname.endsWith('/confirm') && body.factor === 'old') {
        state = replacementState('confirmed')
      } else if (pathname.endsWith('/confirm')) {
        state = {
          maskedAccountEmail: 'N***@mail.ru',
          state: 'password_active',
        }
      } else if (pathname.endsWith('/cancel')) {
        state = {
          maskedAccountEmail: 'N***@mail.ru',
          state: 'password_active',
        }
      }
      const response = pathname.endsWith('/cancel')
        ? { accountProtection: state }
        : {
            accountProtection: state,
            replacement: state.state === 'password_active'
              ? {
                  currentSession: 'active',
                  otherSessions: 'revoked',
                  status: 'completed',
                }
              : {
                  currentSession: 'active',
                  otherSessions: 'unchanged',
                  status: 'pending',
                },
          }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      })
    },
  )

  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(page.getByText('O***@mail.ru', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Заменить почту' }).click()
  const startDialog = page.getByRole('dialog', { name: 'Заменить почту восстановления' })
  await startDialog.getByLabel('Новая почта восстановления').fill('discarded@mail.ru')
  await startDialog.getByLabel('Текущий пароль').fill(e2ePassword)
  await startDialog.getByRole('button', { name: 'Отмена' }).click()
  await page.getByRole('button', { name: 'Заменить почту' }).click()
  await expect(startDialog.getByLabel('Новая почта восстановления')).toHaveValue('')
  await expect(startDialog.getByLabel('Текущий пароль')).toHaveValue('')
  await startDialog.getByLabel('Новая почта восстановления').fill('new@mail.ru')
  await startDialog.getByLabel('Текущий пароль').fill(e2ePassword)
  await startDialog.getByRole('button', { name: 'Отправить два кода' }).click()

  await expect(page.getByRole('heading', { name: 'Подтвердите оба адреса' })).toBeVisible()
  const oldFactor = page.getByRole('heading', { name: 'Старый адрес' }).locator('..').locator('..')
  const newFactor = page.getByRole('heading', { name: 'Новый адрес' }).locator('..').locator('..')
  await expect(oldFactor).toContainText('O***@mail.ru')
  await expect(newFactor).toContainText('N***@mail.ru')
  await oldFactor.getByRole('button', { name: 'Ввести код' }).click()
  const oldCodeDialog = page.getByRole('dialog', { name: 'Подтвердить старый адрес' })
  await oldCodeDialog.getByLabel('Код из письма').fill('111111')
  await oldCodeDialog.getByRole('button', { name: 'Подтвердить' }).click()
  await expect(oldFactor).toContainText('Подтверждён')

  await newFactor.getByRole('button', { name: 'Новый код' }).click()
  await expect(page.getByRole('status')).toContainText('Предыдущий код для этого адреса больше не действует')
  await newFactor.getByRole('button', { name: 'Ввести код' }).click()
  const newCodeDialog = page.getByRole('dialog', { name: 'Подтвердить новый адрес' })
  await newCodeDialog.getByLabel('Код из письма').fill('222222')
  await newCodeDialog.getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('Почта заменена. Все остальные сессии завершены.')).toBeVisible()
  await expect(page.getByText('N***@mail.ru', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('new@mail.ru')
  await expect(page.locator('body')).not.toContainText('111111')
  await expect(page.locator('body')).not.toContainText('222222')

  await page.getByRole('button', { name: 'Заменить почту' }).click()
  await page.getByLabel('Новая почта восстановления').fill('third@mail.ru')
  await page.getByLabel('Текущий пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Отправить два кода' }).click()
  await page.getByRole('button', { name: 'Отменить замену' }).click()
  const cancelDialog = page.getByRole('dialog', { name: 'Отменить замену почты?' })
  await expect(cancelDialog).toContainText('Старый адрес останется активным')
  await cancelDialog.getByRole('button', { name: 'Отменить замену' }).click()
  await expect(page.getByText('Замена отменена. Старый адрес сохранён.')).toBeVisible()

  state = replacementState('pending', false)
  await page.reload()
  await expect(page.getByText('Продолжите в той сессии, где началась замена.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ввести код' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Новый код' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Отменить замену' })).toHaveCount(0)
  expect(mutationBodies).toEqual([
    { email: 'new@mail.ru', password: e2ePassword },
    { code: '111111', factor: 'old' },
    { factor: 'new' },
    { code: '222222', factor: 'new' },
    { email: 'third@mail.ru', password: e2ePassword },
    {},
  ])
})
