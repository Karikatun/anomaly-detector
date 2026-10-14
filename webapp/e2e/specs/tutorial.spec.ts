import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page } from '@playwright/test'
import { expect, registerBrowserUser, test } from '../helpers/test'

const accountProtectionInvitation = {
  action: 'К ЗАЩИТЕ АККАУНТА',
  title: 'Необязательно: защитите аккаунт',
  warning: 'Без подтверждённой почты самостоятельное восстановление доступа невозможно.',
} as const

function captureRuntimeErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  return errors
}

async function expectNoAxeViolations(page: Page) {
  const activeFloater = page.locator('[data-testid="floater"]')
  if (await activeFloater.count() > 0) {
    await expect.poll(() => activeFloater.evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(1)
  }
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
  }))
  const stacking = await page.evaluate(() => {
    const floater = document.querySelector<HTMLElement>('[data-testid="floater"]')
    const overlay = document.querySelector<HTMLElement>('[data-testid="overlay"]')
    if (!floater || !overlay) return null
    const rect = floater.getBoundingClientRect()
    return {
      floaterZIndex: getComputedStyle(floater).zIndex,
      overlayZIndex: getComputedStyle(overlay).zIndex,
      elementsAtCoachCenter: document.elementsFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      ).slice(0, 5).map((element) => ({
        className: String(element.className),
        tagName: element.tagName,
        testId: element.getAttribute('data-testid'),
      })),
    }
  })
  if (stacking) {
    expect(Number(stacking.floaterZIndex)).toBeGreaterThan(Number(stacking.overlayZIndex))
    expect(stacking.elementsAtCoachCenter.some((element) => element.testId === 'floater')).toBe(true)
  }

  const auditOnlyLayers = page.locator('[data-agentation-root]')
  const previousStyles = await auditOnlyLayers.evaluateAll((elements) => elements.map((element) => (
    element.getAttribute('style')
  )))
  // Agentation is an audit tool, not product UI. Keep the actual Joyride overlay in the scan after
  // proving that the coach is above it in the browser stacking order.
  await auditOnlyLayers.evaluateAll((elements) => {
    for (const element of elements) {
      if (element instanceof HTMLElement) element.style.setProperty('display', 'none', 'important')
    }
  })
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
  }))
  let result
  try {
    result = await new AxeBuilder({ page })
      .exclude('[data-agentation-root]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
  } finally {
    await auditOnlyLayers.evaluateAll((elements, styles) => {
      elements.forEach((element, index) => {
        const style = styles[index]
        if (style === null) element.removeAttribute('style')
        else element.setAttribute('style', style)
      })
    }, previousStyles)
  }
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }))
  expect(violations, `stacking context: ${JSON.stringify(stacking)}`).toEqual([])
}

async function focusByTab(page: Page, target: Locator, maximumTabs = 12) {
  for (let attempt = 0; attempt < maximumTabs; attempt += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

async function expectVisibleFocus(target: Locator) {
  await expect(target).toBeFocused()
  await expect.poll(() => target.evaluate((element) => {
    const style = getComputedStyle(element)
    return (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0)
      || style.boxShadow !== 'none'
  })).toBe(true)
}

async function expectTouchTargetsMeetMinimum(page: Page) {
  const undersizedTargets = await page
    .locator('button, select, input, summary, a[href]')
    .evaluateAll((elements) => elements.flatMap((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const before = getComputedStyle(element, '::before')
      const pseudoExpansion = before.content !== 'none'
        ? {
            horizontal: Math.max(0, -Number.parseFloat(before.left))
              + Math.max(0, -Number.parseFloat(before.right)),
            vertical: Math.max(0, -Number.parseFloat(before.top))
              + Math.max(0, -Number.parseFloat(before.bottom)),
          }
        : { horizontal: 0, vertical: 0 }
      const targetWidth = rect.width + pseudoExpansion.horizontal
      const targetHeight = rect.height + pseudoExpansion.vertical
      const outsideViewport = rect.right <= 0
        || rect.bottom <= 0
        || rect.left >= window.innerWidth
        || rect.top >= window.innerHeight
      if (element.closest('[data-agentation-root]')
        || outsideViewport
        || style.visibility === 'hidden'
        || style.display === 'none'
        || rect.width === 0
        || rect.height === 0
        || (element instanceof HTMLButtonElement && element.disabled)
        || (targetWidth >= 24 && targetHeight >= 24)) return []
      return [{
        name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
        width: Math.round(targetWidth),
        height: Math.round(targetHeight),
      }]
    }))
  expect(undersizedTargets).toEqual([])
}

async function startTutorial(page: Page, guest = false) {
  if (guest) await page.goto('/learn')
  else await page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ', exact: true }).click()
  const prologue = page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию', exact: true })
  await expect(prologue).toContainText('Корпорация объявила Тендер')
  await prologue.getByRole('button', { name: 'Начать обучение', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Слот доступа 5:/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ', exact: true })).toHaveCount(0)
}

async function chooseAccessSlot(page: Page, slot: number) {
  await page.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
}

async function allocateFirstPower(page: Page) {
  for (const [category, power] of [['Разведка', 1], ['Лаборатория', 2], ['Анализ модели', 1]] as const) {
    for (let i = 0; i < power; i++) await page.getByRole('button', { name: `Увеличить мощность: ${category}`, exact: true }).click()
  }
  await page.getByRole('button', { name: 'Подтвердить распределение', exact: true }).click()
}

async function reachFirstResearch(page: Page, guest = true) {
  await startTutorial(page, guest)
  await chooseAccessSlot(page, 5)
  await allocateFirstPower(page)
  await page.getByRole('button', { name: /^Сигнал для разведки: Неизвестный/ }).first().click()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await page.getByRole('button', { name: /^Глубокое/ }).click()
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Журнал исследований', exact: true })).toBeHidden()
}

for (const recovery of ['close', 'reload'] as const) {
  test(`guest Interpretation ${recovery} recovery keeps visible guidance and a manual Journal path`, async ({ page }) => {
    test.setTimeout(90_000)
    page.setDefaultTimeout(15_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await reachFirstResearch(page, true)
    const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
    await page.getByTestId('tutorial-research-trigger').click()
    await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
    await expect(journal).toContainText('Цикл типов поля')
    if (recovery === 'close') await page.keyboard.press('Escape')
    else await page.reload()

    await expect(journal).toBeHidden()
    const coach = page.getByTestId('floater')
    await expect(coach).toBeVisible()
    await expect(coach).toContainText('Откройте Журнал на вкладке «Трактовка»')
    await expect(coach).toContainText(/Шаг [1-9]\d* из [1-9]\d*/)
    const entry = page.getByTestId('tutorial-research-trigger')
    await expect(entry).toBeEnabled()
    await entry.click()
    await expect(journal.getByRole('tab', { name: 'Трактовка', exact: true })).toHaveAttribute('aria-selected', 'true')
    await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
    await journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true }).click()
    await journal.getByRole('button', { name: 'Aster: гипотеза, полярность Положительная', exact: true }).click()
    await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
    await expect(page.getByLabel('Сигнал для тезиса', { exact: true })).toBeEnabled()
    await entry.click()
    await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
    await expect(journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await journal.getByRole('tab', { name: 'Данные исследований', exact: true }).click()
    await expect(journal.locator('[data-private-thesis]')).toHaveCount(0)
    await expect(journal).toContainText('За всю игру тезисов ещё нет.')
    await expect(page.getByText('Обучение завершено', { exact: true })).toHaveCount(0)
  })
}

async function openFirstModel(page: Page) {
  await page.getByTestId('tutorial-research-trigger').click()
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  return journal
}

async function playTwoRounds(page: Page, guest: boolean) {
  await startTutorial(page, guest)
  await page.getByRole('button', { name: /^Слот доступа 5:/ }).click()
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
  for (const [category, power] of [['Разведка', 1], ['Лаборатория', 2], ['Анализ модели', 1]] as const) {
    for (let i = 0; i < power; i++) await page.getByRole('button', { name: `Увеличить мощность: ${category}`, exact: true }).click()
  }
  await page.getByRole('button', { name: 'Подтвердить распределение', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: /^Сигнал для разведки: Неизвестный/ }).first().click()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await page.getByRole('button', { name: /^Глубокое/ }).click()
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }).click()
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  await expect(journal).toBeHidden()
  await expect(page.getByText('Публичный журнал', { exact: true })).toHaveCount(0)
  await expect(page.getByText('История тезисов', { exact: true })).toHaveCount(0)
  await page.getByTestId('tutorial-research-trigger').click()
  await expect(journal.getByRole('tab', { name: 'Данные исследований', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(journal).toContainText('Отражение')
  await expect(journal).toContainText('Одинаковая полярность')
  await expect(journal).toContainText('Ваш опыт')
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await expect(journal).toContainText('Цикл типов поля')
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true }).click()
  await journal.getByRole('button', { name: 'Aster: гипотеза, полярность Положительная', exact: true }).click()
  await expect(journal).toBeVisible()
  await journal.getByRole('tab', { name: 'Данные исследований', exact: true }).click()
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await expect(journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Close while the debounce can still be pending: this is a local draft, never a Thesis.
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await expect(journal).toBeHidden()
  await page.getByLabel('Сигнал для тезиса', { exact: true }).selectOption('aster')
  await page.getByLabel('Тип поля для тезиса', { exact: true }).selectOption('inertial')
  await page.getByLabel('Полярность для тезиса', { exact: true }).selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click()
  await expect(journal).toBeHidden()
  await page.getByRole('button', { name: /^Слот доступа 4:/ }).click()
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
  await page.getByTestId('tutorial-contracts-trigger').click()
  await page.getByRole('button', { name: 'Закрыть контракты', exact: true }).click()
  for (const category of ['Разведка', 'Лаборатория', 'Анализ модели', 'Контракты']) {
    await page.getByRole('button', { name: `Увеличить мощность: ${category}`, exact: true }).click()
  }
  await page.getByRole('button', { name: 'Подтвердить распределение', exact: true }).click()
  await page.getByRole('button', { name: /^Сигнал для разведки: Неизвестный/ }).first().click()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await page.getByRole('button', { name: 'Образец: Cinder', exact: true }).click()
  await page.getByRole('button', { name: 'Провести опыт: Boreal → Cinder', exact: true }).click()
  await expect(journal).toBeHidden()
  await page.getByTestId('tutorial-research-trigger').click()
  await expect(journal).toContainText('Личные тезисы')
  await expect(journal).toContainText('Тип верен')
  await expect(journal).toContainText('Раунд 1')
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await journal.getByRole('button', { name: 'Boreal: гипотеза, тип поля Электромагнитное', exact: true }).click()
  await journal.getByRole('button', { name: 'Boreal: гипотеза, полярность Положительная', exact: true }).click()
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await page.getByLabel('Сигнал для тезиса', { exact: true }).selectOption('boreal')
  await page.getByLabel('Тип поля для тезиса', { exact: true }).selectOption('electromagnetic')
  await page.getByLabel('Полярность для тезиса', { exact: true }).selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click()
  await page.locator('[data-contract-id="tutorial-light-contract"]').getByLabel('Подходящее исследование для контракта Boreal · источник').selectOption('tutorial-test-2')
  await page.getByRole('button', { name: 'Зарезервировать контракт: Boreal · источник', exact: true }).click()
  await page.getByRole('button', { name: 'Подтвердить контракт: Boreal · источник', exact: true }).click()
  await page.getByRole('button', { name: 'Отправить финальную модель', exact: true }).click()
}

for (const scenario of [
  { guest: true, viewport: { width: 1440, height: 900 }, name: 'guest' },
  { guest: false, viewport: { width: 1440, height: 900 }, name: 'account' },
  { guest: true, viewport: { width: 390, height: 844 }, name: 'mobile' },
]) {
  test(`optimized ${scenario.name} Journal flow separates manual tabs, draft saves, Thesis commands and final submission`, async ({ page }) => {
    test.setTimeout(120_000)
    page.setDefaultTimeout(15_000)
    const errors = captureRuntimeErrors(page)
    const protectedRequests: string[] = []
    const analyticsEvents: string[] = []
    await page.setViewportSize(scenario.viewport)
    if (!scenario.guest) await registerBrowserUser(page, 'Ученик нового Журнала', 'tutorial-optimized-account')
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (/^\/api\/(rooms|profile|tenders)(\/|$)/.test(path)) protectedRequests.push(request.method())
      if (path === '/api/analytics/events' && request.method() === 'POST') analyticsEvents.push(request.postDataJSON()?.event)
    })
    await playTwoRounds(page, scenario.guest)
    await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
    await expect(page.getByText('В настоящем Тендере будет пять раундов', { exact: false })).toBeVisible()
    if (scenario.guest) {
      await expect(page.getByRole('link', { name: 'Создать аккаунт', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Уже есть аккаунт', exact: true })).toBeVisible()
      expect(protectedRequests).toEqual([])
      await expect.poll(() => analyticsEvents.filter((event) => event === 'tutorial_complete')).toHaveLength(1)
    } else {
      const invitation = page.getByRole('region', { name: accountProtectionInvitation.title })
      await expect(invitation).toContainText(accountProtectionInvitation.warning)
      await expect(page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР', exact: true })).toBeEnabled()
      await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ', exact: true })).toBeEnabled()
    }
    await page.reload()
    await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
    expect(analyticsEvents.filter((event) => event === 'tutorial_complete')).toHaveLength(1)
    await expectNoAxeViolations(page)
    if (!scenario.guest) {
      const action = page.getByRole('button', { name: accountProtectionInvitation.action })
      await focusByTab(page, action)
      await expectVisibleFocus(action)
      await action.press('Enter')
      await expect(page).toHaveURL(/\/profile\/?#account-protection$/)
      await expect(page.locator('#account-protection').getByRole('heading', { name: 'Защита аккаунта' })).toBeVisible()
    }
    expect(errors.filter((error) => error !== 'console: Failed to load resource: the server responded with a status of 401 (Unauthorized)')).toEqual([])
  })
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
  test(`keeps the first action and required laboratory action available at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await reachFirstResearch(page)
    await expect(page.getByTestId('tutorial-research-trigger')).toBeEnabled()
    await page.getByTestId('tutorial-research-trigger').click()
    await expect(page.getByRole('dialog', { name: 'Журнал исследований', exact: true })).toContainText('Одинаковая полярность')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('keeps prologue, Journal tabs, Escape and manual reentry keyboard accessible', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/learn')
  const start = page.getByRole('button', { name: 'Начать обучение', exact: true })
  await focusByTab(page, start)
  await expectVisibleFocus(start)
  await start.press('Enter')
  await chooseAccessSlot(page, 5)
  await allocateFirstPower(page)
  await page.getByRole('button', { name: /^Сигнал для разведки: Неизвестный/ }).first().click()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await page.getByRole('button', { name: /^Глубокое/ }).click()
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }).click()
  const entry = page.getByTestId('tutorial-research-trigger')
  await entry.focus()
  await entry.press('Enter')
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  const research = journal.getByRole('tab', { name: 'Данные исследований', exact: true })
  await research.focus()
  await page.keyboard.press('ArrowRight')
  await expect(journal.getByRole('tab', { name: 'Трактовка', exact: true })).toBeFocused()
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    expect(await journal.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(journal).toBeHidden()
  await expect(entry).toBeFocused()
  await entry.press('Enter')
  await expect(journal).toBeVisible()
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await expect(journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true })).toBeEnabled()
})

test('wrong drafts remain editable and only an explicit Thesis creates scientific feedback in Research', async ({ page }) => {
  await reachFirstResearch(page)
  const journal = await openFirstModel(page)
  const wrong = journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Фазовое', exact: true })
  await wrong.click()
  await journal.getByRole('button', { name: 'Aster: гипотеза, полярность Отрицательная', exact: true }).click()
  await journal.getByRole('tab', { name: 'Данные исследований', exact: true }).click()
  await expect(journal.locator('[data-private-thesis]')).toHaveCount(0)
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await expect(wrong).toHaveAttribute('aria-pressed', 'true')
  await expect(journal.getByRole('alert')).toHaveCount(0)
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await page.getByLabel('Сигнал для тезиса', { exact: true }).selectOption('aster')
  await page.getByLabel('Тип поля для тезиса', { exact: true }).selectOption('phase')
  await page.getByLabel('Полярность для тезиса', { exact: true }).selectOption('negative')
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click()
  await expect(page.getByTestId('floater').getByRole('alert')).toContainText('Подробности находятся в «Данных исследований»')
  await expect(page.getByTestId('floater')).not.toContainText('тип поля неверен')
  await page.getByTestId('tutorial-research-trigger').click()
  await journal.getByRole('tab', { name: 'Данные исследований', exact: true }).click()
  await expect(journal.locator('[data-private-thesis]')).toHaveCount(1)
  await expect(journal).toContainText('Тип неверен')
  await expect(journal).toContainText('Полярность неверна')
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await page.getByLabel('Тип поля для тезиса', { exact: true }).selectOption('inertial')
  await page.getByLabel('Полярность для тезиса', { exact: true }).selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Слот доступа 4:/ })).toBeEnabled()
})

test('Journal retains real Research scroll through tabs, early close and manual reopening on a short screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await reachFirstResearch(page)
  const journal = await openFirstModel(page)
  await page.setViewportSize({ width: 390, height: 520 })
  const researchTab = journal.getByRole('tab', { name: 'Данные исследований', exact: true })
  await researchTab.click()
  const research = journal.getByRole('tabpanel', { name: 'Данные исследований', exact: true })
  const position = await research.evaluate((panel) => { panel.scrollTop = 49; return panel.scrollTop })
  expect(position).toBeGreaterThan(0)
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await researchTab.click()
  expect(await research.evaluate((panel) => panel.scrollTop)).toBe(position)
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await page.getByTestId('tutorial-research-trigger').click()
  await researchTab.click()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await research.evaluate((panel) => panel.scrollTop)).toBe(position)
  await page.screenshot({ path: testInfo.outputPath('journal-reopened-390x520.png') })
  await page.setViewportSize({ width: 390, height: 430 })
  const measurement = research.getByText('Одинаковая полярность', { exact: true })
  await measurement.scrollIntoViewIfNeeded()
  await expect(measurement).toBeInViewport({ ratio: .99 })
  await page.screenshot({ path: testInfo.outputPath('journal-short-390x430.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await measurement.scrollIntoViewIfNeeded()
  await expect(measurement).toBeInViewport({ ratio: .99 })
  await page.screenshot({ path: testInfo.outputPath('journal-textscale-200.png') })
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
})

test('reflows at a 200% desktop zoom equivalent and honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 720, height: 450 })
  await reachFirstResearch(page)
  await page.getByTestId('tutorial-research-trigger').click()
  await expect(page.getByRole('tab', { name: 'Данные исследований', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('preserves the first action through dynamic portrait viewport changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await startTutorial(page, true)
  const slot = page.getByRole('button', { name: /^Слот доступа 5:/ })
  await slot.click()
  await page.setViewportSize({ width: 390, height: 700 })
  await expect(slot).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(slot).toHaveAttribute('aria-pressed', 'true')
  await expectTouchTargetsMeetMinimum(page)
})

test('required unallocated Power warning stays actionable above the mobile tutorial coach', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await startTutorial(page, true)
  await chooseAccessSlot(page, 5)
  await page.setViewportSize({ width: 390, height: 700 })
  const confirm = page.getByRole('button', { name: 'Подтвердить распределение', exact: true })
  await confirm.press('Enter')
  const warning = page.getByRole('dialog', { name: 'Часть мощности не распределена', exact: true })
  await expect(warning).toBeVisible()
  await expect(page.getByTestId('floater')).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('power-warning-390x700.png'), animations: 'disabled' })
  await warning.getByRole('button', { name: 'Подтвердить и продолжить', exact: true }).click()
  await expect(warning).toBeHidden()
  await expect(page.getByTestId('floater')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Разведка 1, Лаборатория 2, Анализ модели 1, Контракты 0')
  await confirm.press('Enter')
  await warning.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Вернуться к распределению', exact: true }).click()
  await expect(warning).toBeHidden()
  await expect(page.getByTestId('floater')).toBeVisible()
  await expect(confirm).toBeFocused()
})

test('exits the tutorial through its confirmation dialog and clears the saved step', async ({ page }) => {
  await registerBrowserUser(page, 'Выходящий ученик', 'tutorial-exit')
  await startTutorial(page)
  await page.getByRole('button', { name: /^Слот доступа 5:/ }).click()
  await page.getByTestId('floater').getByRole('button', { name: 'Выйти из обучения', exact: true }).click()
  const exit = page.getByRole('dialog', { name: 'Выйти из обучения?', exact: true })
  await exit.getByRole('button', { name: 'Выйти и сбросить', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию', exact: true })).toBeVisible()
})

test('confirmed account exit discards a pending partial model draft before SPA reentry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await registerBrowserUser(page, 'Ученик с незавершённой гипотезой', 'tutorial-pending-exit')
  await reachFirstResearch(page, false)
  await page.getByTestId('tutorial-research-trigger').click()
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  const partialField = journal.getByRole('button', {
    name: 'Aster: гипотеза, тип поля Фазовое', exact: true,
  })
  await partialField.click()
  const editedAt = Date.now()
  await expect(partialField).toHaveAttribute('aria-pressed', 'true')
  await expect(journal.getByRole('button', {
    name: 'Aster: гипотеза, полярность Положительная', exact: true,
  })).toHaveAttribute('aria-pressed', 'false')
  await expect(journal.getByRole('button', {
    name: 'Aster: гипотеза, полярность Отрицательная', exact: true,
  })).toHaveAttribute('aria-pressed', 'false')
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await page.getByTestId('floater').getByRole('button', { name: 'Выйти из обучения', exact: true }).click()
  await page.getByRole('dialog', { name: 'Выйти из обучения?', exact: true })
    .getByRole('button', { name: 'Выйти и сбросить', exact: true }).click()
  expect(Date.now() - editedAt, 'Exit must exercise the pending autosave boundary').toBeLessThan(800)
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('anomaly-detector:tutorial-session')))
    .toBeNull()
  await page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ', exact: true }).click()
  const prologue = page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию', exact: true })
  await expect(prologue).toBeVisible()
  await prologue.getByRole('button', { name: 'Начать обучение', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Слот доступа 5:/ })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem('anomaly-detector:tutorial-session') ?? 'null')
    return state?.step
  })).toBe('round-1-access')
})

test('logged-in mobile lesson retains its draft after completion save fails and retries explicitly', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerBrowserUser(page, 'Ученик с повторным сохранением', 'tutorial-mobile-retry')
  let completionAttempts = 0
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/api/profile/tutorial/completion')) completionAttempts += 1
  })
  await page.route('**/api/profile/tutorial/completion', (route) => route.fulfill({
    contentType: 'application/json',
    status: 503,
    body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary failure' } }),
  }))

  await playTwoRounds(page, false)
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeHidden()
  await expect(page.getByRole('alert')).toContainText('отметку об обучении пока не удалось сохранить')
  const retry = page.getByRole('button', { name: 'Сохранить отметку', exact: true })
  await expect(retry).toBeEnabled()
  expect(completionAttempts).toBe(1)
  const retainedDraft = await page.evaluate(() => sessionStorage.getItem('anomaly-detector:tutorial-session'))
  expect(retainedDraft).not.toBeNull()
  expect(JSON.parse(retainedDraft!)).toMatchObject({ step: 'complete', round: 2,
    workingModel: { signals: { aster: { hypothesis: { fieldType: 'inertial', polarity: 'positive' } } } } })

  await page.unroute('**/api/profile/tutorial/completion')
  const saved = page.waitForResponse((response) => response.request().method() === 'PUT'
    && response.url().endsWith('/api/profile/tutorial/completion') && response.status() === 200)
  await retry.click()
  expect((await (await saved).json()).completedAt).toBeTruthy()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  expect(completionAttempts).toBe(2)
  expect(await page.evaluate(() => sessionStorage.getItem('anomaly-detector:tutorial-session'))).toBe(retainedDraft)
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР', exact: true })).toBeEnabled()
})

async function openSavedCompletionWithAccountProtection(
  page: Page,
  accountProtection: Record<string, unknown>,
  responseStatus = 200,
  responseGate?: Promise<void>,
) {
  await startTutorial(page)
  await page.route('**/api/auth/account-protection', async (route) => {
    await responseGate
    await route.fulfill({
      contentType: 'application/json',
      status: responseStatus,
      body: JSON.stringify(responseStatus === 200
        ? { accountProtection }
        : { error: { code: 'UNAVAILABLE', message: 'Temporary failure' } }),
    })
  })
  await page.evaluate(() => {
    const key = 'anomaly-detector:tutorial-session'
    const serialized = sessionStorage.getItem(key)
    if (!serialized) throw new Error('Tutorial session is unavailable')
    const state = JSON.parse(serialized) as { step: string }
    state.step = 'complete'
    sessionStorage.setItem(key, JSON.stringify(state))
  })
  await page.reload()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
}

async function elementBox(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

function expectBoxWithinViewport(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
) {
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
}

function expectStableBox(
  before: { x: number; y: number; width: number; height: number },
  after: { x: number; y: number; width: number; height: number },
  tolerance = 2,
) {
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(tolerance)
}

test('keeps completion actions available when account protection lookup fails', async ({ page }) => {
  await registerBrowserUser(page, 'Ученик без статуса защиты', 'tutorial-protection-unavailable')
  await openSavedCompletionWithAccountProtection(page, {}, 503)

  await expect(page.getByRole('region', { name: accountProtectionInvitation.title })).toHaveCount(0)
  await expect(page.getByText(accountProtectionInvitation.title, { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' })).toBeEnabled()
})

test('keeps the primary completion action stable while account protection loads on mobile', async ({ page }, testInfo) => {
  const viewport = { width: 390, height: 844 }
  await page.setViewportSize(viewport)
  await registerBrowserUser(page, 'Ученик с задержкой защиты', 'tutorial-protection-delayed')

  let releaseAccountProtectionResponse!: () => void
  const responseGate = new Promise<void>((resolve) => {
    releaseAccountProtectionResponse = resolve
  })
  const accountProtectionRequest = page.waitForRequest('**/api/auth/account-protection')
  await Promise.all([
    openSavedCompletionWithAccountProtection(
      page,
      { state: 'password_unprotected' },
      200,
      responseGate,
    ),
    accountProtectionRequest,
  ])

  const createTenderAction = page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР' })
  const protectionInvitation = page.getByRole('region', {
    name: accountProtectionInvitation.title,
  })
  await expect(createTenderAction).toBeVisible()
  await expect(protectionInvitation).toHaveCount(0)
  const beforeResponse = await elementBox(createTenderAction)
  await page.screenshot({ path: testInfo.outputPath('completion-before-protection.png'), fullPage: true })
  expectBoxWithinViewport(beforeResponse, viewport)

  releaseAccountProtectionResponse()
  await expect(protectionInvitation).toContainText(accountProtectionInvitation.warning)
  const afterResponse = await elementBox(createTenderAction)
  const invitationBox = await elementBox(protectionInvitation)
  expectBoxWithinViewport(afterResponse, viewport)
  expectStableBox(beforeResponse, afterResponse)
  expect(invitationBox.y).toBeGreaterThanOrEqual(afterResponse.y + afterResponse.height)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expectTouchTargetsMeetMinimum(page)
  await expectNoAxeViolations(page)
})

for (const scenario of [
  {
    accountProtection: {
      maskedAccountEmail: 'y***@yandex.ru',
      state: 'yandex_managed',
    },
    name: 'Yandex-managed account',
  },
  {
    accountProtection: {
      maskedAccountEmail: 'p***@mail.ru',
      recoveryCodes: 'available',
      state: 'password_active',
    },
    name: 'protected password account',
  },
] as const) {
  test(`does not show the Recovery Email invitation to a ${scenario.name}`, async ({ page }) => {
    await registerBrowserUser(page, `Ученик ${scenario.name}`, `tutorial-no-invite-${scenario.accountProtection.state}`)
    await openSavedCompletionWithAccountProtection(page, scenario.accountProtection)

    await expect(page.getByRole('region', { name: accountProtectionInvitation.title })).toHaveCount(0)
    await expect(page.getByText(accountProtectionInvitation.title, { exact: true })).toHaveCount(0)
    await expect(page.getByText(accountProtectionInvitation.warning, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', {
      name: accountProtectionInvitation.action,
    })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' })).toBeEnabled()
  })
}

for (const viewport of [
  { height: 900, label: '1440x900', slug: '1440', width: 1440 },
  { height: 768, label: '1024x768', slug: '1024', width: 1024 },
] as const) {
  test(`keeps completion actions available with the account protection invitation at ${viewport.label}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await registerBrowserUser(page, `Ученик ${viewport.slug}`, `tutorial-protect-${viewport.slug}`)
    await openSavedCompletionWithAccountProtection(page, { state: 'password_unprotected' })

    const protectionInvitation = page.getByRole('region', {
      name: accountProtectionInvitation.title,
    })
    await expect(protectionInvitation).toContainText(accountProtectionInvitation.warning)
    await expect(page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' })).toBeEnabled()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expectTouchTargetsMeetMinimum(page)
    await expectNoAxeViolations(page)
    await page.screenshot({ path: testInfo.outputPath('completion-with-protection.png'), fullPage: true })
  })
}

test('blocks a direct tutorial entry while the player has an active room', async ({ page }) => {
  await registerBrowserUser(page, 'Занятый ученик E2E', 'tutorial-blocked')
  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  await page.getByLabel('Количество игроков').selectOption('2')
  await page.getByRole('button', { name: 'Создать команду' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)
  await expect(page.getByRole('heading', { name: 'Лобби' })).toBeVisible()

  await page.goto('/tutorial')
  await expect(page).toHaveURL('/tutorial')
  await expect(page.getByText('Сначала завершите активный Тендер', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться в матч' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)
})
