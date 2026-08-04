import { expect, registerBrowserUser, test } from '../helpers/test'

const tasks = {
  roundOneRecon: 'Исследуйте Неизвестный сектор, чтобы получить второй Образец.',
  roundOneThesis: 'Отправьте Тезис по Астеру. Тип поля и полярность проверяются отдельно, а в обучении ошибку можно исправить без штрафа.',
  roundTwoThesis: 'Подтвердите свойства Бореала вторым Тезисом.',
  contractBid: 'Проверьте выбранный опыт и отправьте заявку на контракт.',
} as const

function currentTask(page: Parameters<typeof registerBrowserUser>[0], task: string) {
  return page.getByTestId('floater').getByText(task, { exact: true })
}

async function expectCoachWithinViewport(page: Parameters<typeof registerBrowserUser>[0]) {
  const coach = page.getByTestId('floater').locator('[data-joyride-step]')
  await expect(coach).toBeVisible()
  await expect(page.getByTestId('overlay')).toBeVisible()
  const box = await coach.boundingBox()
  const viewport = page.viewportSize()
  expect(box, 'tutorial coach must have measurable geometry').not.toBeNull()
  expect(viewport, 'tutorial viewport must be configured').not.toBeNull()
  expect(box!.y, 'tutorial coach must not be clipped above the viewport').toBeGreaterThanOrEqual(8)
  expect(
    box!.y + box!.height,
    'tutorial coach must not be clipped below the viewport',
  ).toBeLessThanOrEqual(viewport!.height - 8)
  const overflow = await coach.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(
    overflow.scrollHeight,
    'tutorial task text must fit without scrolling inside the coach',
  ).toBeLessThanOrEqual(overflow.clientHeight)
}

async function expectTargetInMobileInteractiveArea(
  page: Parameters<typeof registerBrowserUser>[0],
  selector: string,
) {
  const target = page.locator(selector)
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  const viewport = page.viewportSize()
  expect(box, 'tutorial target must have measurable geometry').not.toBeNull()
  expect(viewport, 'tutorial viewport must be configured').not.toBeNull()
  expect(box!.y, 'tutorial target must stay below the sticky header').toBeGreaterThanOrEqual(120)
  expect(
    box!.y + box!.height,
    'tutorial target must stay above the mobile coach',
  ).toBeLessThanOrEqual(viewport!.height - 288)
}

async function chooseAccessSlot(page: Parameters<typeof registerBrowserUser>[0], slot: 4 | 5) {
  await page.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
  await page.getByRole('button', { name: 'Подтвердить выбор' }).click()
}

async function allocatePower(
  page: Parameters<typeof registerBrowserUser>[0],
  allocation: Record<'Разведка' | 'Лаборатория' | 'Анализ модели' | 'Контракты', number>,
) {
  for (const [category, count] of Object.entries(allocation)) {
    for (let index = 0; index < count; index += 1) {
      await page.getByRole('button', { name: `Увеличить мощность: ${category}` }).click()
    }
  }
  await page.getByRole('button', { name: 'Подтвердить распределение' }).click()
}

async function runReconnaissance(page: Parameters<typeof registerBrowserUser>[0]) {
  await page.getByRole('button', { name: 'Сигнал для разведки: Неизвестный сигнал A' }).click()
  await page.getByRole('button', { name: 'Исследовать' }).click()
}

async function runLaboratoryTest(
  page: Parameters<typeof registerBrowserUser>[0],
  source: 'Aster' | 'Boreal',
  receiver: 'Boreal' | 'Cinder',
  mode?: 'Глубокое',
) {
  if (mode) await page.getByRole('button', { name: mode }).click()
  await page.getByRole('button', { name: `Образец: ${source}` }).click()
  await page.getByRole('button', { name: `Образец: ${receiver}` }).click()
  await page.getByRole('button', { name: `Провести опыт: ${source} → ${receiver}` }).click()
}

async function saveHypothesis(
  page: Parameters<typeof registerBrowserUser>[0],
  signal: 'Aster' | 'Boreal',
  fieldType: 'Инерционное' | 'Электромагнитное',
) {
  const fieldButton = page.getByRole('button', { name: `${signal}: гипотеза, тип поля ${fieldType}` })
  const isMobile = (page.viewportSize()?.width ?? 0) <= 600
  if (isMobile) {
    await page.getByRole('button', { name: 'Рабочая модель' }).click()
  }
  await fieldButton.click()
  await page.getByRole('button', { name: `${signal}: гипотеза, полярность Положительная` }).click()
  const closeWorkingModel = page.getByRole('button', { name: 'Закрыть рабочую модель' })
  if (isMobile) await expect(closeWorkingModel).toBeHidden()
}

async function submitThesis(
  page: Parameters<typeof registerBrowserUser>[0],
  signal: 'aster' | 'boreal',
  fieldType: 'inertial' | 'electromagnetic',
) {
  await page.getByLabel('Сигнал для тезиса').selectOption(signal)
  await page.getByLabel('Тип поля для тезиса').selectOption(fieldType)
  await page.getByLabel('Полярность для тезиса').selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис' }).click()
}

test('completes the two-round tutorial, restores its tab-local step, and records only completion', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await registerBrowserUser(page, 'Ученик E2E', 'tutorial-happy')

  await page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ' }).click()
  await expect(page).toHaveURL(/\/tutorial\/?$/)
  await expect(page.getByRole('button', { name: 'Рабочая модель' })).toBeVisible()
  await expect(page.getByTestId('working-model-table')).toBeHidden()
  await expectCoachWithinViewport(page)
  await chooseAccessSlot(page, 5)
  await expectCoachWithinViewport(page)
  await allocatePower(page, {
    'Разведка': 1,
    'Лаборатория': 2,
    'Анализ модели': 1,
    'Контракты': 0,
  })
  await expect(currentTask(page, tasks.roundOneRecon)).toBeVisible()
  await expectCoachWithinViewport(page)

  await page.reload()
  await expect(currentTask(page, tasks.roundOneRecon)).toBeVisible()
  await expectCoachWithinViewport(page)
  await runReconnaissance(page)
  await expectCoachWithinViewport(page)
  await runLaboratoryTest(page, 'Aster', 'Boreal', 'Глубокое')
  await expectCoachWithinViewport(page)

  await expect(page.getByText(
    'Верный тезис даёт +1 Рейтинг и личную сертификацию. Ошибка включает вашу персональную проверку.',
    { exact: true },
  )).toBeVisible()
  await expect(page.getByRole('button', { name: 'Справка', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Правила', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Трактовка анализов', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Цикл типов поля')
  await expectCoachWithinViewport(page)
  await page.getByRole('button', { name: 'Закрыть трактовку анализов' }).click()

  await expectCoachWithinViewport(page)
  await saveHypothesis(page, 'Aster', 'Инерционное')
  await expect(currentTask(page, tasks.roundOneThesis)).toBeVisible()
  await expectCoachWithinViewport(page)
  await submitThesis(page, 'aster', 'inertial')

  await page.setViewportSize({ width: 390, height: 844 })
  await expectCoachWithinViewport(page)
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-access-slot="4"]')
  await expect(page.getByRole('button', { name: 'Справка', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Правила', exact: true })).toBeHidden()
  await chooseAccessSlot(page, 4)
  await expectCoachWithinViewport(page)
  await allocatePower(page, {
    'Разведка': 1,
    'Лаборатория': 1,
    'Анализ модели': 1,
    'Контракты': 1,
  })
  await expectCoachWithinViewport(page)
  await runReconnaissance(page)
  await expectCoachWithinViewport(page)
  await runLaboratoryTest(page, 'Boreal', 'Cinder')

  await expectCoachWithinViewport(page)
  await saveHypothesis(page, 'Boreal', 'Электромагнитное')
  await expect(currentTask(page, tasks.roundTwoThesis)).toBeVisible()
  await expectCoachWithinViewport(page)
  await submitThesis(page, 'boreal', 'electromagnetic')

  await expectCoachWithinViewport(page)
  await page.getByLabel('Подходящее исследование').selectOption('tutorial-test-2')
  await page.getByRole('button', { name: 'Зарезервировать контракт tutorial-light-contract' }).click()
  await expect(currentTask(page, tasks.contractBid)).toBeVisible()
  await expectCoachWithinViewport(page)
  await page.getByRole('button', { name: 'Подтвердить контракт tutorial-light-contract' }).click()

  await expect(page.getByLabel('Заполнено параметров: 4')).toBeVisible()
  await expectCoachWithinViewport(page)
  await page.getByRole('button', { name: 'Отправить финальную модель' }).click()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  await expect(page.getByText('В обычном Тендере пять раундов', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ' }).click()
  await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' })).toBeVisible()
  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(
    page.getByText('Сыграно матчей').locator('..').getByText('0', { exact: true }),
  ).toBeVisible()
})

test('keeps the next mobile tutorial action available after laboratory interpretation', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerBrowserUser(page, 'Мобильный ученик E2E', 'tutorial-mobile-interpretation')

  await page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ' }).click()
  await expectCoachWithinViewport(page)
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-access-slot="5"]')
  await chooseAccessSlot(page, 5)
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-power-options]')
  await allocatePower(page, {
    'Разведка': 1,
    'Лаборатория': 2,
    'Анализ модели': 1,
    'Контракты': 0,
  })
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-recon-options]')
  await runReconnaissance(page)
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-lab-options]')
  await runLaboratoryTest(page, 'Aster', 'Boreal', 'Глубокое')

  await page.getByRole('button', { name: 'Справка', exact: true }).click()
  await page.getByRole('button', { name: 'Трактовка анализов', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Трактовка лабораторных анализов' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть трактовку анализов' }).click()

  await expect(page.getByText('Правила игры и трактовка результатов исследований.', { exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Рабочая модель' })).toBeEnabled()
  await expect(page.getByTestId('floater').getByText('Откройте Рабочую модель', { exact: false })).toBeVisible()
})

test('blocks a direct tutorial entry while the player has an active room', async ({ page }) => {
  await registerBrowserUser(page, 'Занятый ученик E2E', 'tutorial-blocked')
  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  await page.getByLabel('Количество игроков').selectOption('2')
  await page.getByRole('button', { name: 'Создать команду' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)

  await page.goto('/tutorial')
  await expect(page.getByText('Сначала завершите активный Тендер', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться в матч' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)
})
