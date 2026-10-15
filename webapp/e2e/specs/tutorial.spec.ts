import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page } from '@playwright/test'
import { expect, registerBrowserUser, test } from '../helpers/test'

// Explicit local guest fixture for a preserved live stand whose analytics flag is disabled.
// Keep the normal E2E server path intact; this fixture never creates an authenticated session.
test.beforeEach(async ({ page, baseURL }) => {
  if (process.env.TUTORIAL_PILOT_GUEST_FIXTURE !== 'local-guest') return
  if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Guest fixture requires loopback')
  const origin = new URL(baseURL).origin
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) return route.abort('blockedbyclient')
    if (url.pathname === '/api/auth/refresh' && request.method() === 'POST') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Anonymous guest fixture' } }) })
    }
    if (url.pathname === '/api/analytics/events' && request.method() === 'POST') {
      return route.fulfill({ status: 204 })
    }
    if (url.pathname.startsWith('/api/')) return route.abort('blockedbyclient')
    return route.continue()
  })
})

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

async function settleTutorialCapture(page: Page) {
  const coach = page.getByTestId('floater')
  await expect(coach).toBeVisible()
  await expect.poll(() => coach.evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(1)
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map((animation) => animation.finished.catch(() => undefined)))
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
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

// Observe availability before Playwright can scroll a target into view for a click.
async function expectTutorialActionAvailable(page: Page, target: Locator) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect.poll(() => target.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const viewport = window.visualViewport
    const top = viewport?.offsetTop ?? 0
    const left = viewport?.offsetLeft ?? 0
    if (rect.top < top || rect.bottom > top + (viewport?.height ?? innerHeight)
      || rect.left < left || rect.right > left + (viewport?.width ?? innerWidth)) return false
    return [[.1, .1], [.9, .1], [.5, .5], [.1, .9], [.9, .9]].every(([x, y]) => {
      const hit = document.elementFromPoint(rect.left + rect.width * x!, rect.top + rect.height * y!)
      return hit !== null && element.contains(hit)
    })
  }), { message: 'Current tutorial action must be fully visible and unobscured before any helper scroll' }).toBe(true)
}

async function expectTutorialSpotlightOnTarget(page: Page, target: Locator) {
  await expect.poll(async () => {
    const spotlight = await page.locator('.react-joyride__spotlight path').last().evaluate((element) => {
      const path = element as SVGGraphicsElement
      const box = path.getBBox(), matrix = path.getScreenCTM()!
      const topLeft = new DOMPoint(box.x, box.y).matrixTransform(matrix)
      const bottomRight = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix)
      return { top: topLeft.y, left: topLeft.x, bottom: bottomRight.y, right: bottomRight.x }
    })
    const bounds = await target.boundingBox()
    if (!bounds) return false
    return spotlight.top <= bounds.y && spotlight.bottom >= bounds.y + bounds.height
      && spotlight.left <= bounds.x && spotlight.right >= bounds.x + bounds.width
      && spotlight.bottom - spotlight.top <= bounds.height + 32
      && spotlight.right - spotlight.left <= bounds.width + 32
  }, { message: 'Spotlight must fit the actual current control in screen coordinates' }).toBe(true)
}

test('tutorial positions each nearest action before interaction and preserves manual scrolling', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await page.route('**/*', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) return route.abort('blockedbyclient')
    if (url.pathname === '/api/auth/refresh' && request.method() === 'POST') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Anonymous tutorial' } }) })
    }
    if (url.pathname.startsWith('/api/')) return route.abort('blockedbyclient')
    return route.continue()
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startTutorial(page, true)
  await expectTutorialActionAvailable(page, page.locator('[data-tutorial-access-slot="5"]'))
  const details = page.getByRole('button', { name: 'Подробнее', exact: true })
  // A player may read the prompt before asking for its explanation.
  await page.waitForTimeout(500)
  await details.click()
  await page.waitForTimeout(250)
  await expectTutorialActionAvailable(page, page.locator('[data-tutorial-access-slot="5"]'))
  await details.click()
  await page.locator('[data-tutorial-access-slot="5"]').click()
  await expect(page.getByTestId('floater')).toContainText('Нажмите «Подтвердить выбор»')
  await expectTutorialActionAvailable(page, page.getByRole('button', { name: 'Подтвердить выбор', exact: true }))
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
  for (const [category, count] of [['Разведка', 1], ['Лаборатория', 2], ['Анализ модели', 1]] as const) {
    const increase = page.getByRole('button', { name: `Увеличить мощность: ${category}`, exact: true })
    await expectTutorialActionAvailable(page, increase.locator('xpath=ancestor::article'))
    await expect(page.getByTestId('floater')).toContainText(`${category}: установите ${count}`)
    for (let index = 0; index < count; index++) await increase.click()
  }
  await expectTutorialActionAvailable(page, page.getByRole('button', { name: 'Подтвердить распределение', exact: true }))
  const collisions = await page.getByTestId('tutorial-research-trigger').evaluate((entry) => {
    const a = entry.getBoundingClientRect()
    return [...document.querySelectorAll('[data-tutorial-power-category] button')].some((control) => {
      const b = control.getBoundingClientRect()
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    })
  })
  expect(collisions, 'Journal entry must not cover power controls').toBe(false)
  const beforeManualScroll = await page.evaluate(() => scrollY)
  await page.mouse.move(24, 320)
  await page.mouse.wheel(0, -160)
  await page.waitForTimeout(250)
  const manualPosition = await page.evaluate(() => scrollY)
  expect(Math.abs(manualPosition - beforeManualScroll)).toBeGreaterThan(1)
  await page.waitForTimeout(750)
  expect(await page.evaluate(() => scrollY)).toBe(manualPosition)
})

test('first tutorial explanations preserve selection and advance only on the game command', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await startTutorial(page, true)
  const coach = page.getByTestId('floater')
  const explanation = coach.getByRole('button', { name: 'Подробнее', exact: true })
  await expect(explanation).toHaveAttribute('aria-expanded', 'false')
  const slot = page.getByRole('button', { name: /^Слот доступа 5:/ })
  await slot.click()
  await explanation.focus()
  await page.keyboard.press('Enter')
  await expect(explanation).toHaveAttribute('aria-expanded', 'true')
  await expect(coach.getByRole('region', { name: 'Подробное объяснение' })).toContainText('Слот задаёт порядок хода')
  await expect(slot).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Space')
  await expect(explanation).toHaveAttribute('aria-expanded', 'false')
  await expect(slot).toHaveAttribute('aria-pressed', 'true')
  await coach.getByRole('button', { name: 'Выйти из обучения', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить обучение', exact: true }).click()
  await expect(slot).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Увеличить мощность: Разведка', exact: true })).toBeEnabled()
  await expect(explanation).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Увеличить мощность: Разведка', exact: true })).toBeEnabled()
  await expect(explanation).toHaveAttribute('aria-expanded', 'false')
})

async function chooseAccessSlot(page: Page, slot: number) {
  await page.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
}

async function allocateFirstPower(page: Page) {
  for (const [category, power] of [['Разведка', 1], ['Лаборатория', 2], ['Анализ модели', 1]] as const) {
    const increase = page.getByRole('button', { name: `Увеличить мощность: ${category}`, exact: true })
    await expectTutorialActionAvailable(page, increase)
    for (let i = 0; i < power; i++) await increase.click()
  }
  await page.getByRole('button', { name: 'Подтвердить распределение', exact: true }).click()
}

async function reachFirstResearch(page: Page, guest = true, textScale?: string) {
  await startTutorial(page, guest)
  if (textScale) {
    await page.evaluate((scale) => { document.documentElement.style.fontSize = scale }, textScale)
    await expectTutorialActionAvailable(page, page.locator('[data-tutorial-access-slot="5"]'))
  }
  await chooseAccessSlot(page, 5)
  await allocateFirstPower(page)
  await page.getByRole('button', { name: /^Сигнал для разведки: Неизвестный/ }).first().click()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await page.getByRole('button', { name: /^Глубокое/ }).click()
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  const confirm = page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true })
  await expectTutorialActionAvailable(page, confirm)
  await expectTutorialSpotlightOnTarget(page, confirm)
  await confirm.click()
  await expect(page.getByRole('dialog', { name: 'Журнал исследований', exact: true })).toBeHidden()
  await expectTutorialActionAvailable(page, page.getByTestId('tutorial-research-trigger'))
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
 test(`first result explanation stays inside Journal keyboard navigation at ${viewport.width}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport)
  const errors = captureRuntimeErrors(page)
  const failedResponses: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`)
  })
  const capture = async (name: string) => {
    await settleTutorialCapture(page)
    console.log(JSON.stringify({ capture: name, viewport, layout: await page.evaluate(() => {
      const coach = document.querySelector<HTMLElement>('[data-testid="floater"]')!
      const rect = coach.getBoundingClientRect()
      return { scrollY, coach: { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, width: rect.width }, documentWidth: document.documentElement.scrollWidth, innerWidth }
    }) }))
    await page.screenshot({ path: testInfo.outputPath(`${name}-${viewport.width}.png`) })
  }
  await startTutorial(page, true)
  const analyticsModule = await page.request.get('/src/platform/analytics/product-analytics.ts')
  const compiledAnalytics = await analyticsModule.text()
  const configuredAnalytics = compiledAnalytics.match(/"VITE_ANALYTICS_ENABLED"\s*:\s*"(true|false)"/)?.[1] ?? 'absent'
  console.log(JSON.stringify({ fixture: 'compiled-client-feature-flag', configuredAnalytics }))
  await capture('slot')
  await page.getByTestId('floater').getByRole('button', { name: 'Подробнее', exact: true }).click()
  await capture('slot-detail')
  await page.getByTestId('floater').getByRole('button', { name: 'Подробнее', exact: true }).click()
  await page.getByRole('button', { name: /^Слот доступа 5:/ }).click()
  const beforeConfirmScroll = await page.evaluate(() => scrollY)
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
  const afterConfirmScroll = await page.evaluate(() => scrollY)
  await page.waitForTimeout(300)
  console.log(JSON.stringify({ transition: 'slot-to-power', viewport, beforeConfirmScroll, afterConfirmScroll, settledScroll: await page.evaluate(() => scrollY) }))
  await capture('power')
  await allocateFirstPower(page)
  await page.getByRole('button', { name: /^Сигнал для разведки: Неизвестный/ }).first().click()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await page.getByRole('button', { name: /^Глубокое/ }).click()
  await capture('first-experiment')
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await expectTutorialActionAvailable(page, page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }))
  await expectTutorialSpotlightOnTarget(page, page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }))
  await page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }).click()
  await capture('result-entry')
  await page.getByTestId('tutorial-research-trigger').click()
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  const explanation = journal.getByRole('button', { name: 'Подробнее', exact: true })
  await expect(explanation).toHaveAttribute('aria-expanded', 'false')
  await focusByTab(page, explanation, 40)
  await page.keyboard.press('Enter')
  await expect(explanation).toHaveAttribute('aria-expanded', 'true')
  await expect(journal.getByRole('region', { name: 'Подробное объяснение' })).toContainText('Посмотрите направление опыта')
  await expect(journal).toContainText('Одинаковая полярность')
  await capture('result-detail')
  await page.keyboard.press('Space')
  await expect(explanation).toHaveAttribute('aria-expanded', 'false')
  await capture('result')
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await expect(journal).toBeHidden()
  await page.getByTestId('tutorial-research-trigger').click()
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await expect(journal).toContainText('Цикл типов поля')
  await expect(page.getByTestId('floater')).toContainText('Перейдите во вкладку «Рабочая модель»')
  expect(failedResponses.filter((response) => response !== '401 /api/auth/refresh')).toEqual([])
  expect(errors.filter((error) => error !== 'console: Failed to load resource: the server responded with a status of 401 (Unauthorized)')).toEqual([])
 })
}

for (const edge of [{ width: 384, height: 430, scale: '100%' }, { width: 390, height: 844, scale: '200%' }]) {
  test(`first pilot controls and Journal close remain reachable at ${edge.width}x${edge.height} text ${edge.scale}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: edge.width, height: edge.height })
    await reachFirstResearch(page, true, edge.scale)
    await page.getByTestId('tutorial-research-trigger').click()
    const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
    const measurement = journal.getByText('Одинаковая полярность', { exact: true })
    await expectTutorialActionAvailable(page, journal.locator('[data-research-experiment] > p').first())
    const reading = journal.locator('[role="tabpanel"][data-state="active"]')
    const scroll = await reading.evaluate((element) => {
      const panel = element.getBoundingClientRect()
      const measurement = element.querySelector('[data-private]:not([data-private-thesis]) p')!.getBoundingClientRect()
      return { x: panel.left + panel.width / 2, y: panel.top + panel.height / 2, distance: measurement.top - panel.top - panel.height / 2 }
    })
    await page.mouse.move(scroll.x, scroll.y)
    await page.mouse.wheel(0, Math.max(0, scroll.distance))
    await expectTutorialActionAvailable(page, measurement)
    await expect(measurement).toBeInViewport({ ratio: .99 })
    const readingPosition = await reading.evaluate((panel) => panel.scrollTop)
    await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
    await expect(journal).toBeHidden()
    await page.getByTestId('tutorial-research-trigger').click()
    await expect(journal.getByRole('tab', { name: 'Данные исследований', exact: true })).toHaveAttribute('data-state', 'active')
    await settleTutorialCapture(page)
    expect(await reading.evaluate((panel) => panel.scrollTop)).toBe(readingPosition)
    await expectTutorialActionAvailable(page, measurement)
    await expectTutorialActionAvailable(page, journal.getByRole('tab', { name: 'Трактовка', exact: true }))
    const explanation = journal.getByRole('button', { name: 'Подробнее', exact: true })
    await explanation.click()
    await expect(explanation).toHaveAttribute('aria-expanded', 'true')
    await explanation.click()
    await expect(explanation).toHaveAttribute('aria-expanded', 'false')
    await settleTutorialCapture(page)
    await page.screenshot({ path: testInfo.outputPath('edge-result.png') })
    await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
    await expect(journal).toBeHidden()
    await expect(page.getByTestId('tutorial-research-trigger')).toBeFocused()
    await page.getByTestId('floater').getByRole('button', { name: 'Выйти из обучения', exact: true }).click()
    await page.getByRole('button', { name: 'Продолжить обучение', exact: true }).click()
    await page.getByTestId('tutorial-research-trigger').click()
    await expect(journal).toBeVisible()
    await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
    await expectTutorialActionAvailable(page, journal.getByRole('tab', { name: 'Рабочая модель', exact: true }))
  })
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

test.describe('tutorial positions through phone orientation', () => {
  test.use({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('tutorial positions retain Journal selection and focus through the portrait guard', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Screen orientation emulation requires Chromium CDP')
    const session = await page.context().newCDPSession(page)
    const rotate = async (landscape: boolean) => {
      const width = landscape ? 844 : 390, height = landscape ? 390 : 844
      await page.setViewportSize({ width, height })
      await session.send('Emulation.setDeviceMetricsOverride', {
        width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: true,
        screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 },
      })
    }
    await rotate(false)
    await reachFirstResearch(page, true)
    const journal = await openFirstModel(page)
    const hypothesis = journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true })
    await hypothesis.click()
    await expect(hypothesis).toBeFocused()
    await rotate(true)
    const guard = page.getByRole('dialog', { name: 'Поверните телефон вертикально', exact: true })
    await expect(guard).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await expect(guard).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('landscape-guard.png') })
    await rotate(false)
    await expect(guard).toBeHidden()
    await expect(journal).toBeVisible()
    await expect(hypothesis).toHaveAttribute('aria-pressed', 'true')
    await expect(hypothesis).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('portrait-restored.png') })
  })
})

async function openFirstModel(page: Page) {
  await page.getByTestId('tutorial-research-trigger').click()
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  return journal
}

async function playTwoRounds(page: Page, guest: boolean, checkpoint: (expected?: string) => Promise<void> = async () => undefined) {
  await startTutorial(page, guest)
  await checkpoint()
  await page.getByRole('button', { name: /^Слот доступа 5:/ }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
  await checkpoint()
  await allocateFirstPower(page)
  await checkpoint()
  await page.reload()
  await checkpoint()
  await page.getByRole('button', { name: /^Сигнал для разведки: Неизвестный/ }).first().click()
  await checkpoint()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: /^Глубокое/ }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }).click()
  await checkpoint()
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  await expect(journal).toBeHidden()
  await expect(page.getByText('Публичный журнал', { exact: true })).toHaveCount(0)
  await expect(page.getByText('История тезисов', { exact: true })).toHaveCount(0)
  await page.getByTestId('tutorial-research-trigger').click()
  await checkpoint()
  await expect(journal.getByRole('tab', { name: 'Данные исследований', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(journal).toContainText('Отражение')
  await expect(journal).toContainText('Одинаковая полярность')
  await expect(journal).toContainText('Ваш опыт')
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await checkpoint()
  await expect(journal).toContainText('Цикл типов поля')
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: 'Aster: гипотеза, полярность Положительная', exact: true }).click()
  await checkpoint()
  await expect(journal).toBeVisible()
  await journal.getByRole('tab', { name: 'Данные исследований', exact: true }).click()
  await checkpoint()
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await checkpoint()
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await checkpoint()
  await expect(journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Close while the debounce can still be pending: this is a local draft, never a Thesis.
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await checkpoint()
  await expect(journal).toBeHidden()
  await page.getByLabel('Сигнал для тезиса', { exact: true }).selectOption('aster')
  await page.getByLabel('Тип поля для тезиса', { exact: true }).selectOption('inertial')
  await page.getByLabel('Полярность для тезиса', { exact: true }).selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click()
  await checkpoint()
  await expect(journal).toBeHidden()
  await page.getByRole('button', { name: /^Слот доступа 4:/ }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
  await checkpoint()
  await page.getByTestId('tutorial-contracts-trigger').click()
  await checkpoint('round-2-contracts-review-open')
  await page.getByRole('button', { name: 'Закрыть контракты', exact: true }).click()
  await checkpoint()
  for (const category of ['Разведка', 'Лаборатория', 'Анализ модели', 'Контракты']) {
    const increase = page.getByRole('button', { name: `Увеличить мощность: ${category}`, exact: true })
    await expectTutorialActionAvailable(page, increase)
    await increase.click()
    await checkpoint()
  }
  await page.getByRole('button', { name: 'Подтвердить распределение', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: /^Сигнал для разведки: Неизвестный/ }).first().click()
  await checkpoint()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await checkpoint()
  await expectTutorialActionAvailable(page, page.getByRole('button', { name: 'Образец: Cinder', exact: true }))
  await page.getByRole('button', { name: 'Образец: Cinder', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Провести опыт: Boreal → Cinder', exact: true }).click()
  await checkpoint()
  await expect(journal).toBeHidden()
  await page.getByTestId('tutorial-research-trigger').click()
  await checkpoint()
  await expect(journal).toContainText('Личные тезисы')
  await expect(journal).toContainText('Тип верен')
  await expect(journal).toContainText('Раунд 1')
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: 'Boreal: гипотеза, тип поля Электромагнитное', exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: 'Boreal: гипотеза, полярность Положительная', exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await checkpoint()
  await page.getByLabel('Сигнал для тезиса', { exact: true }).selectOption('boreal')
  await page.getByLabel('Тип поля для тезиса', { exact: true }).selectOption('electromagnetic')
  await page.getByLabel('Полярность для тезиса', { exact: true }).selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click()
  await checkpoint()
  await page.locator('[data-contract-id="tutorial-light-contract"]').getByLabel('Подходящее исследование для контракта Boreal · источник').selectOption('tutorial-test-2')
  await page.getByRole('button', { name: 'Зарезервировать контракт: Boreal · источник', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Подтвердить контракт: Boreal · источник', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Отправить финальную модель', exact: true }).click()
  await checkpoint()
}
for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
  test(`tutorial named actions stay available through the full guest lesson at ${viewport.width}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors = captureRuntimeErrors(page)
    const seen = new Set<string>()
    const targets: Record<string, string> = {
      'round-1-access': '[data-tutorial-access-slot="5"]',
      'round-1-power': '[data-tutorial-power-category="reconnaissance"]',
      'round-1-recon': '[data-tutorial-recon-anchor]',
      'round-1-lab-mode': '[data-tutorial-lab-modes] button:first-child',
      'round-1-lab-pair': '[data-tutorial-lab-sample="aster"]',
      'research-results': '[data-testid="tutorial-research-trigger"]',
      'research-results-open': '[data-tender-journal] [data-research-experiment]',
      'interpretation-open': '[data-tutorial-journal-tab="working-model"]',
      'round-1-working-model': '[data-tender-journal] [data-tutorial-working-model-row="aster"] [role="group"]:not([data-options]) button:first-child',
      'round-1-thesis': '[data-tutorial-thesis]',
      'round-2-access': '[data-tutorial-access-slot="4"]',
      'round-2-contracts-review': '[data-testid="tutorial-contracts-trigger"]',
      'round-2-contracts-review-open': '[data-testid="tutorial-contracts-dialog"] [data-slot="dialog-close"]',
      'round-2-power': '[data-tutorial-power-category="reconnaissance"]',
      'round-2-recon': '[data-tutorial-recon-anchor]',
      'round-2-lab': '[data-tutorial-lab-sample="boreal"]',
      'round-2-research': '[data-testid="tutorial-research-trigger"]',
      'round-2-research-open': '[data-tender-journal] [data-research-experiment]:first-child',
      'round-2-working-model': '[data-tender-journal] [data-tutorial-working-model-row="boreal"] [role="group"]:not([data-options]) button:nth-child(2)',
      'round-2-thesis': '[data-tutorial-thesis]',
      'round-2-contract-reserve': '[data-contract-id="tutorial-light-contract"]',
      'round-2-contract-bid': '[data-contract-id="tutorial-light-contract"]',
      'final-model': '[data-tutorial-final-submit]',
    }
    await playTwoRounds(page, true, async (expected) => {
      if (!expected && !await page.locator('[data-tutorial-step]').count()) return
      if (expected) {
        await expect(page.getByTestId('tutorial-contracts-dialog')).toBeVisible()
        await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('anomaly-detector:guest-tutorial-session') ?? '{}').step)).toBe(expected)
      }
      else await settleTutorialCapture(page)
      const coach = page.locator('[data-tutorial-step]').first()
      const step = expected ?? await coach.getAttribute('data-tutorial-step')
      if (!step || seen.has(step) || !targets[step]) return
      await expectTutorialActionAvailable(page, page.locator(targets[step]!))
      if (!expected && await page.locator('.react-joyride__spotlight path').count()) {
        await expectTutorialSpotlightOnTarget(page, page.locator(targets[step]!))
      }
      seen.add(step)
      await page.screenshot({ path: testInfo.outputPath(`${step}-${viewport.width}.png`) })
      if (step === 'interpretation-open') {
        await page.keyboard.press('Escape')
        await expectTutorialActionAvailable(page, page.getByTestId('tutorial-research-trigger'))
        await expect(page.locator('[data-tutorial-step="interpretation"]')).toBeVisible()
        seen.add('interpretation')
        await expectTutorialSpotlightOnTarget(page, page.getByTestId('tutorial-research-trigger'))
        await page.screenshot({ path: testInfo.outputPath(`interpretation-${viewport.width}.png`) })
        await page.getByTestId('tutorial-research-trigger').click()
      }
    })
    await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
    expect([...seen].sort()).toEqual([...Object.keys(targets), 'interpretation'].sort())
    expect(errors.filter((error) => error !== 'console: Failed to load resource: the server responded with a status of 401 (Unauthorized)')).toEqual([])
    console.log(JSON.stringify({ viewport, activeSteps: [...seen], count: seen.size }))
  })
}

test('tutorial positions a fresh lesson after Repeat restores a new reading task', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 520 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let readPrivately = false
  await playTwoRounds(page, true, async () => {
    if (readPrivately || await page.locator('[data-tutorial-step="research-results-open"]').count() === 0) return
    const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
    const reading = journal.getByRole('tabpanel', { name: 'Данные исследований', exact: true })
    const point = await reading.evaluate((panel) => {
      const bounds = panel.getBoundingClientRect()
      const measurement = panel.querySelector('[data-private]:not([data-private-thesis]) > p')!.getBoundingClientRect()
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, distance: measurement.top - bounds.top - bounds.height / 2 }
    })
    await page.mouse.move(point.x, point.y)
    await page.mouse.wheel(0, Math.max(0, point.distance))
    await expectTutorialActionAvailable(page, journal.getByText('Одинаковая полярность', { exact: true }))
    expect(await reading.evaluate((panel) => panel.scrollTop)).toBeGreaterThan(0)
    readPrivately = true
  })
  expect(readPrivately).toBe(true)
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ', exact: true }).click()
  await page.getByRole('button', { name: 'Начать обучение', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expectTutorialActionAvailable(page, page.locator('[data-tutorial-access-slot="5"]'))
  await chooseAccessSlot(page, 5)
  await allocateFirstPower(page)
  await page.getByRole('button', { name: /^Сигнал для разведки: Неизвестный/ }).first().click()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await page.getByRole('button', { name: /^Глубокое/ }).click()
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }).click()
  await expectTutorialActionAvailable(page, page.getByTestId('tutorial-research-trigger'))
  await page.getByTestId('tutorial-research-trigger').click()
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  await expectTutorialActionAvailable(page, journal.locator('[data-research-experiment] > p').first())
  await expectTutorialActionAvailable(page, journal.getByRole('tab', { name: 'Трактовка', exact: true }))
  await settleTutorialCapture(page)
  await page.screenshot({ path: testInfo.outputPath('repeat-fresh-reading-task.png') })
})

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

test('guest Journal remains available after cancelling Exit on a short mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await reachFirstResearch(page)
  const firstModel = await openFirstModel(page)
  await firstModel.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true }).click()
  await firstModel.getByRole('button', { name: 'Aster: гипотеза, полярность Положительная', exact: true }).click()
  await firstModel.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await page.getByLabel('Сигнал для тезиса', { exact: true }).selectOption('aster')
  await page.getByLabel('Тип поля для тезиса', { exact: true }).selectOption('inertial')
  await page.getByLabel('Полярность для тезиса', { exact: true }).selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click()
  await chooseAccessSlot(page, 4)
  await page.getByTestId('tutorial-contracts-trigger').click()
  await page.getByRole('button', { name: 'Закрыть контракты', exact: true }).click()
  for (const layout of [{ height: 430, textScale: '100%' }, { height: 844, textScale: '200%' }]) {
    await page.setViewportSize({ width: 390, height: layout.height })
    await page.evaluate((textScale) => { document.documentElement.style.fontSize = textScale }, layout.textScale)
    // The player pauses to read the task before opening Exit.
    await page.waitForTimeout(1_500)
    const coach = page.getByTestId('floater')
    await coach.getByRole('button', { name: 'Выйти из обучения', exact: true }).click()
    await page.getByRole('button', { name: 'Продолжить обучение', exact: true }).click()
    await page.getByTestId('tutorial-research-trigger').click()
    const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
    await expect(journal).toBeVisible()
    await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
    await expect(journal).toBeHidden()
  }
})

test('preserves the first action through dynamic portrait viewport changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await startTutorial(page, true)
  const slot = page.getByRole('button', { name: /^Слот доступа 5:/ })
  await expectTutorialActionAvailable(page, slot)
  await page.setViewportSize({ width: 390, height: 700 })
  await expectTutorialActionAvailable(page, slot)
  await slot.click()
  await expectTutorialActionAvailable(page, page.getByRole('button', { name: 'Подтвердить выбор', exact: true }))
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
