import { expect, registerBrowserUser, test } from '../helpers/test'

const tasks = {
  interactionGuide: 'Небольшое правило: если вы видите кнопку «ПОНЯТНО, ДАЛЬШЕ», просто прочитайте подсказку и нажмите её. Трогать игровое поле нужно только тогда, когда подсказка прямо просит что-то выбрать, открыть или подтвердить.',
  header: 'Наверху всегда видно, что происходит в игре: текущий раунд и фазу, ваш слот, Бюджет и порядок хода. Справа можно открыть Справку или выйти из обучения. Таймера здесь нет — можно не спешить.',
  headerMobile: 'В верхней части экрана всегда видны текущий раунд и фаза, ваш слот, Бюджет и порядок хода. Здесь же находятся Справка и выход из обучения. Таймера нет — можно не спешить.',
  sidebar: 'Справа собрана вся полезная информация. Здесь видно, чей сейчас ход, а ниже можно открыть результаты исследований, Рабочую модель и Контракты.',
  sidebarMobile: 'На телефоне информационный блок находится ниже игрового поля. В нём видно, чей сейчас ход, а ещё отсюда открываются результаты исследований, Рабочая модель и Контракты.',
  contracts: 'Контракты — это дополнительные задания от корпораций. Каждый Контракт объясняет, какие доказательства нужно собрать и сколько Рейтинга можно получить. Пока просто запомните, где они находятся: совсем скоро мы выполним один вместе.',
  contractsMobile: 'Контракты находятся в информационном блоке под игровым полем. Это дополнительные задания от корпораций: в каждом указаны нужные доказательства и награда. Пока просто запомните эту кнопку — скоро мы выполним один Контракт вместе.',
  accessIntro: 'Слот задаёт очерёдность хода. Чем меньше номер, тем раньше вы действуете, но за это иногда приходится платить Бюджетом. Поздний слот, наоборот, может принести компенсацию. Если несколько игроков выбрали одно место, блок «Правило выбора слота» покажет, кому оно достанется.',
  roundOneRecon: 'Получим ещё один Образец. Выберите «Неизвестный Сигнал» и нажмите «Исследовать».',
  roundOneLabMode: 'Выберите, как потратить 2 Мощности. «Глубокое» исследование даст один опыт и личную подсказку о полярностях. «Широкое» даст два опыта, но без такой подсказки. Сейчас выберите «Глубокое».',
  roundOneLabPair: 'Теперь зададим направление опыта. Сначала выберите Aster — он будет источником. Затем выберите Boreal — он будет приёмником. Нажмите «Провести опыт».',
  researchResultsMobile: 'Опыт завершён. Его результат появился в разделе «Данные исследований» под игровым полем. Откройте этот раздел.',
  roundOneModel: 'Запишем первую догадку. Откройте Рабочую модель и укажите для Aster тип «Инерционное» и полярность «Положительная». Изменения сохраняются автоматически — после выбора закройте окно.',
  roundOneThesis: 'Пора проверить догадку. Выберите Сигнал Aster, тип «Инерционное» и полярность «Положительная», затем нажмите «Выдвинуть тезис». Игра отдельно проверит тип и полярность. Если ошибётесь, в обучении можно попробовать ещё раз без штрафа.',
  thesisResult: 'Тезис проверен. Откройте «Данные исследований» и посмотрите, что получилось.',
  contractsReview: 'Прежде чем распределять Мощность, заглянем в Контракты. Откройте их и проверьте, какие задания уже можно выполнить.',
  roundTwoModel: 'Теперь попробуйте сделать вывод сами. Опыт Aster → Boreal дал «Отражение»: тип Boreal идёт сразу после типа Aster, а их полярности одинаковы. Откройте Рабочую модель, заполните Boreal и закройте окно. Изменения сохраняются автоматически.',
  roundTwoThesis: 'Верно: Boreal — «Электромагнитное» с положительной полярностью. Теперь выберите Boreal, эти же тип и полярность, затем нажмите «Выдвинуть тезис».',
  contractBid: 'Доказательство выбрано. Проверьте его ещё раз и нажмите «Подтвердить контракт».',
  finalModel: 'Подтверждённые свойства Aster и Boreal уже перенесены в Финальную модель. В обучении остальные Сигналы можно оставить пустыми. Нажмите «Отправить финальную модель».',
  helpDesktop: 'Теперь разберёмся, что означает «Отражение». Откройте «Трактовку анализов» в верхней части экрана.',
} as const

async function startTutorial(page: Parameters<typeof registerBrowserUser>[0]) {
  await page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ' }).click()
  const prologue = page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию' })
  await expect(prologue).toContainText('Корпорация объявила Тендер')
  await expect(prologue.getByRole('button', { name: 'Вернуться в главное меню' })).toBeVisible()
  const startAction = () => prologue.getByRole('button', { name: 'Начать обучение' }).click()
  if ((page.viewportSize()?.width ?? 0) <= 600) {
    const requests = await captureScrollRequests(page, startAction)
    expect(requests, 'the before-start step must not scroll an oversized target').toEqual([])
  } else {
    await startAction()
  }
  await expect(currentTask(page, tasks.interactionGuide)).toBeVisible()
  await expect(page.getByTestId('floater').getByText('Перед началом', { exact: true })).toBeVisible()
  await expect(page.locator('[data-tutorial-access-slot][data-selected]')).toHaveCount(0)
  await expect(page.getByText('Слот: 5', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
}

async function continueInformationStep(page: Parameters<typeof registerBrowserUser>[0], task: string) {
  await expect(currentTask(page, task)).toBeVisible()
  await expectCoachWithinViewport(page)
  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
}

async function captureScrollTransition(
  page: Parameters<typeof registerBrowserUser>[0],
  action: () => Promise<void>,
) {
  const [samples] = await Promise.all([
    page.evaluate(() => new Promise<number[]>((resolve) => {
      const positions: number[] = []
      const startedAt = performance.now()
      const sample = () => {
        positions.push(window.scrollY)
        if (performance.now() - startedAt < 500) window.requestAnimationFrame(sample)
        else resolve(positions)
      }
      window.requestAnimationFrame(sample)
    })),
    action(),
  ])
  return samples
}

function expectSmoothAutoScroll(transitions: number[][]) {
  const movement = transitions
    .map((samples) => ({
      endY: samples.at(-1) ?? samples[0] ?? 0,
      samples,
      startY: samples[0] ?? 0,
    }))
    .sort((left, right) => Math.abs(right.endY - right.startY) - Math.abs(left.endY - left.startY))[0]
  expect(movement, 'tutorial actions must expose scroll transition samples').toBeDefined()
  expect(
    Math.abs(movement!.endY - movement!.startY),
    'tutorial must automatically scroll to a distant target after a mobile action',
  ).toBeGreaterThan(24)
  const startY = movement!.startY
  const endY = movement!.endY
  const lower = Math.min(startY, endY) + 1
  const upper = Math.max(startY, endY) - 1
  const intermediatePositions = new Set(movement!.samples
    .filter((position) => position > lower && position < upper)
    .map((position) => Math.round(position)))
  expect(
    intermediatePositions.size,
    'mobile tutorial auto-scroll must move through intermediate positions instead of jumping',
  ).toBeGreaterThanOrEqual(2)
}

async function captureScrollRequests(
  page: Parameters<typeof registerBrowserUser>[0],
  action: () => Promise<void>,
) {
  await page.evaluate(() => {
    type ScrollRecorder = typeof window & {
      __tutorialOriginalScrollTo?: typeof window.scrollTo
      __tutorialScrollRequests?: Array<{ time: number; top: number }>
    }
    const recorder = window as ScrollRecorder
    recorder.__tutorialScrollRequests = []
    recorder.__tutorialOriginalScrollTo = window.scrollTo.bind(window)
    window.scrollTo = ((...args: Parameters<typeof window.scrollTo>) => {
      const options = typeof args[0] === 'object' ? args[0] : undefined
      recorder.__tutorialScrollRequests!.push({
        time: performance.now(),
        top: options?.top ?? Number(args[1] ?? window.scrollY),
      })
      recorder.__tutorialOriginalScrollTo!(...args)
    }) as typeof window.scrollTo
  })
  await action()
  await page.waitForTimeout(700)
  return page.evaluate(() => {
    const recorder = window as typeof window & {
      __tutorialOriginalScrollTo?: typeof window.scrollTo
      __tutorialScrollRequests?: Array<{ time: number; top: number }>
    }
    const requests = recorder.__tutorialScrollRequests ?? []
    if (recorder.__tutorialOriginalScrollTo) window.scrollTo = recorder.__tutorialOriginalScrollTo
    delete recorder.__tutorialOriginalScrollTo
    delete recorder.__tutorialScrollRequests
    return requests
  })
}

async function waitForScrollToSettle(page: Parameters<typeof registerBrowserUser>[0]) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let settledTimer = window.setTimeout(done, 80)
    const maximumTimer = window.setTimeout(done, 700)
    function done() {
      window.clearTimeout(settledTimer)
      window.clearTimeout(maximumTimer)
      window.removeEventListener('scroll', handleScroll)
      resolve()
    }
    function handleScroll() {
      window.clearTimeout(settledTimer)
      settledTimer = window.setTimeout(done, 80)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
  }))
}

async function completeInitialInterfaceTour(page: Parameters<typeof registerBrowserUser>[0]) {
  const isMobile = (page.viewportSize()?.width ?? 0) <= 600
  await continueInformationStep(page, isMobile ? tasks.headerMobile : tasks.header)
  await expectTutorialFrameFullyVisible(page, '[data-tutorial-sidebar]')
  await continueInformationStep(page, isMobile ? tasks.sidebarMobile : tasks.sidebar)
  await expect(page.getByRole('button', { name: 'Контракты этого раунда · 2' })).toBeVisible()
  await expectTutorialFrameFullyVisible(page, '[data-tutorial-contracts]')
  if (isMobile) await expectTargetClearOfCoach(page, '[data-testid="tutorial-contracts-trigger"]')
  await continueInformationStep(page, isMobile ? tasks.contractsMobile : tasks.contracts)
  await continueInformationStep(page, tasks.accessIntro)
  await expect(page.locator('[data-tutorial-access-slot][data-selected]')).toHaveCount(0)
  await expect(page.getByText('Слот: 5', { exact: true })).toHaveCount(0)
}

async function expectTargetClearOfCoach(
  page: Parameters<typeof registerBrowserUser>[0],
  selector: string,
) {
  await expect.poll(async () => {
    const [targetBox, coachBox] = await Promise.all([
      page.locator(selector).boundingBox(),
      page.getByTestId('floater').locator('[data-joyride-step]').boundingBox(),
    ])
    if (!targetBox || !coachBox) return false
    return targetBox.y + targetBox.height + 8 <= coachBox.y
      || coachBox.y + coachBox.height + 8 <= targetBox.y
  }, {
    message: 'tutorial coach must not cover the highlighted target',
  }).toBe(true)
}

function currentTask(page: Parameters<typeof registerBrowserUser>[0], task: string) {
  return page.getByTestId('floater').getByText(task, { exact: true })
}

async function expectCoachWithinViewport(
  page: Parameters<typeof registerBrowserUser>[0],
  options: { expectDocumentFits?: boolean } = {},
) {
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
  if (viewport!.width > 600) {
    expect(viewport!.width - (box!.x + box!.width)).toBeGreaterThanOrEqual(12)
    expect(viewport!.width - (box!.x + box!.width)).toBeLessThanOrEqual(20)
    expect(viewport!.height - (box!.y + box!.height)).toBeGreaterThanOrEqual(12)
    expect(viewport!.height - (box!.y + box!.height)).toBeLessThanOrEqual(20)
  }
  const overflow = await coach.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }))
  if (viewport!.width <= 600) {
    expect(
      overflow.overflowY,
      'tutorial coach must not become an inner vertical scroll container',
    ).not.toMatch(/auto|scroll/)
  }
  expect(
    overflow.scrollHeight,
    'tutorial task text must fit without scrolling inside the coach',
  ).toBeLessThanOrEqual(overflow.clientHeight)
  if (options.expectDocumentFits !== false) await expectNoDesktopDocumentScroll(page)
}

async function expectNoDesktopDocumentScroll(page: Parameters<typeof registerBrowserUser>[0]) {
  if ((page.viewportSize()?.width ?? 0) <= 600) return
  const geometry = await page.evaluate(() => ({
    body: document.body.scrollHeight,
    document: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    contentBottom: Math.max(
      ...Array.from(document.querySelector<HTMLElement>('[data-tutorial-board]')?.children ?? [])
        .map((element) => element.getBoundingClientRect().bottom),
    ),
  }))
  if (geometry.contentBottom > geometry.viewport) return
  expect(
    Math.max(geometry.body, geometry.document),
    'desktop tutorial must not create document scroll when its content fits the viewport',
  ).toBeLessThanOrEqual(geometry.viewport)
}

async function expectTargetInMobileInteractiveArea(
  page: Parameters<typeof registerBrowserUser>[0],
  selector: string,
  placement: 'above-coach' | 'below-coach' = 'above-coach',
) {
  const target = page.locator(selector)
  const coach = page.getByTestId('floater').locator('[data-joyride-step]')
  await expect(target).toBeVisible()
  const header = page.locator('[aria-label="УЧЕБНЫЙ ТЕНДЕР"] > header')
  await expect.poll(async () => {
    const [box, headerBox] = await Promise.all([target.boundingBox(), header.boundingBox()])
    if (!box || !headerBox) return Number.NEGATIVE_INFINITY
    return box.y - (headerBox.y + headerBox.height)
  }, {
    message: 'tutorial target must stay below the sticky header',
  }).toBeGreaterThanOrEqual(8)
  if (placement === 'above-coach') {
    await expect.poll(async () => {
      const [box, coachBox] = await Promise.all([target.boundingBox(), coach.boundingBox()])
      if (!box || !coachBox) return Number.NEGATIVE_INFINITY
      return coachBox.y - (box.y + box.height)
    }, {
      message: 'tutorial target must stay above the mobile coach',
    }).toBeGreaterThanOrEqual(8)
  } else {
    await expect.poll(async () => {
      const [box, coachBox] = await Promise.all([target.boundingBox(), coach.boundingBox()])
      if (!box || !coachBox) return Number.NEGATIVE_INFINITY
      return box.y - (coachBox.y + coachBox.height)
    }, {
      message: 'tutorial target must stay below the mobile coach',
    }).toBeGreaterThanOrEqual(8)
  }
  await waitForScrollToSettle(page)
  await expect.poll(async () => {
    const [box, coachBox, headerBox] = await Promise.all([
      target.boundingBox(),
      coach.boundingBox(),
      header.boundingBox(),
    ])
    if (!box || !coachBox || !headerBox) return Number.POSITIVE_INFINITY
    const safeTop = placement === 'below-coach'
      ? coachBox.y + coachBox.height + 12
      : Math.max(12, headerBox.y + headerBox.height + 20)
    const safeBottom = placement === 'below-coach'
      ? page.viewportSize()!.height - 12
      : coachBox.y - 12
    return Math.max(
      0,
      box.y + box.height - safeBottom,
      safeTop - box.y,
    )
  }, {
    message: 'tutorial target must fit the available mobile area without forced top alignment',
  }).toBeLessThanOrEqual(1)
}

async function expectRequiredActionAvailable(
  page: Parameters<typeof registerBrowserUser>[0],
  action: ReturnType<Parameters<typeof registerBrowserUser>[0]['getByRole']>,
) {
  const actionReceivesPointer = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit === element || element.contains(hit)
  })
  expect(actionReceivesPointer, 'required tutorial action must receive pointer input above the overlay').toBe(true)

  if ((page.viewportSize()?.width ?? 0) > 600) return

  const coach = page.getByTestId('floater').locator('[data-joyride-step]')
  const [actionBox, coachBox] = await Promise.all([action.boundingBox(), coach.boundingBox()])
  await expect(coach.getByText('Подтвердите действие', { exact: true })).toBeVisible()
  expect(actionBox, 'required tutorial action must have measurable geometry').not.toBeNull()
  expect(coachBox, 'tutorial coach must have measurable geometry').not.toBeNull()
  expect(
    actionBox!.y,
    'required tutorial action must remain below the raised coach',
  ).toBeGreaterThanOrEqual(coachBox!.y + coachBox!.height + 8)
  expect(
    actionBox!.y + actionBox!.height,
    'required tutorial action must remain visible inside the viewport before Playwright scrolls to it',
  ).toBeLessThanOrEqual(page.viewportSize()!.height - 8)
}

async function expectDimmedControlBlocked(
  page: Parameters<typeof registerBrowserUser>[0],
  control: ReturnType<Parameters<typeof registerBrowserUser>[0]['getByRole']>,
) {
  const controlReceivesPointer = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit === element || element.contains(hit)
  })
  expect(controlReceivesPointer, 'dimmed tutorial controls must be covered by the overlay').toBe(false)
}

async function expectReadingDialogAvailable(
  page: Parameters<typeof registerBrowserUser>[0],
  dialog: ReturnType<Parameters<typeof registerBrowserUser>[0]['getByRole']>,
) {
  const overlayFill = await page.getByTestId('spotlight').locator('path').first().evaluate(
    (path) => getComputedStyle(path).fill,
  )
  expect(overlayFill, 'the page outside a reading dialog must remain dimmed').not.toBe('rgba(0, 0, 0, 0)')
  const dialogInteraction = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      hitTag: hit?.tagName ?? null,
      hitTestId: hit instanceof HTMLElement ? hit.dataset.testid ?? null : null,
      receivesPointer: hit === element || element.contains(hit),
      zIndex: getComputedStyle(element).zIndex,
    }
  })
  expect(dialogInteraction, 'the spotlighted reading dialog must stay interactive').toMatchObject({
    receivesPointer: true,
    zIndex: '101',
  })
  await expectCoachAboveDialog(page, dialog)
}

async function expectCoachAboveDialog(
  page: Parameters<typeof registerBrowserUser>[0],
  dialog: ReturnType<Parameters<typeof registerBrowserUser>[0]['locator']>,
) {
  await expect.poll(async () => dialog.evaluate((dialogElement) => {
    const coachElement = document.querySelector<HTMLElement>('[data-testid="floater"]')
    if (!coachElement) return { aboveDialog: false }
    const coachZIndex = Number(getComputedStyle(coachElement).zIndex)
    const dialogZIndex = Number(getComputedStyle(dialogElement).zIndex)
    return {
      aboveDialog: coachZIndex > dialogZIndex,
      coachZIndex,
      dialogZIndex,
    }
  }), {
    message: 'an open tutorial dialog must not cover the tutorial message',
  }).toMatchObject({
    aboveDialog: true,
  })
}

async function expectElementDimmed(
  page: Parameters<typeof registerBrowserUser>[0],
  selector: string,
) {
  const element = page.locator(selector)
  const covered = await element.evaluate((target) => {
    const rect = target.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit !== target && !target.contains(hit)
  })
  expect(covered, 'content outside the spotlight must remain under the overlay').toBe(true)
}

async function expectTutorialFrameFullyVisible(
  page: Parameters<typeof registerBrowserUser>[0],
  selector: string,
) {
  const target = page.locator(selector)
  await expect(target).toBeVisible()
  const viewport = page.viewportSize()
  expect(viewport, 'tutorial viewport must be configured').not.toBeNull()
  await expect.poll(async () => {
    const box = await target.boundingBox()
    if (!box) return Number.NEGATIVE_INFINITY
    return Math.min(
      box.x,
      box.y,
      viewport!.width - (box.x + box.width),
      viewport!.height - (box.y + box.height),
    )
  }, {
    message: 'tutorial frame must become fully visible after automatic scrolling',
  }).toBeGreaterThanOrEqual(8)
  const [stroke, legacyFrame] = await Promise.all([
    page.getByTestId('spotlight').locator('path').last().getAttribute('stroke'),
    target.evaluate((element) => {
      const style = getComputedStyle(element)
      return { boxShadow: style.boxShadow, outlineStyle: style.outlineStyle }
    }),
  ])
  expect(stroke, 'tutorial spotlight must draw one consistent visible frame').toBe('#38bdf8')
  expect(legacyFrame.outlineStyle, 'tutorial target must not keep a second CSS outline').toBe('none')
  expect(legacyFrame.boxShadow, 'tutorial target must not keep the old cyan CSS glow').not.toContain('56, 189, 248')
}

async function expectSpotlightMatchesTarget(
  page: Parameters<typeof registerBrowserUser>[0],
  selector: string,
) {
  await expect.poll(async () => page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    const spotlightPath = Array.from(
      document.querySelectorAll<SVGGeometryElement>('[data-testid="spotlight"] path'),
    ).find((path) => path.getAttribute('stroke') === '#38bdf8')
    if (!target || !spotlightPath) return Number.POSITIVE_INFINITY

    const targetRect = target.getBoundingClientRect()
    const spotlightRect = spotlightPath.getBoundingClientRect()
    const expectedPadding = 8
    return Math.max(
      Math.abs(spotlightRect.left - (targetRect.left - expectedPadding)),
      Math.abs(spotlightRect.top - (targetRect.top - expectedPadding)),
      Math.abs(spotlightRect.right - (targetRect.right + expectedPadding)),
      Math.abs(spotlightRect.bottom - (targetRect.bottom + expectedPadding)),
    )
  }, selector), {
    message: `tutorial spotlight must frame ${selector}, not a neighboring control`,
  }).toBeLessThanOrEqual(1)
}

async function captureVisibleSpotlightMismatchDuringStepChange(
  page: Parameters<typeof registerBrowserUser>[0],
  step: string,
  selector: string,
  action: () => Promise<void>,
) {
  const [transition] = await Promise.all([
    page.evaluate(({ selector: targetSelector, step: expectedStep }) => new Promise<{
      hiddenWhileMoving: number
      mismatches: number[]
    }>((resolve) => {
      const mismatches: number[] = []
      let hiddenWhileMoving = 0
      const deadline = performance.now() + 2_000
      let startedAt: number | null = null
      let previousScrollY = window.scrollY

      const sample = () => {
        const currentStep = document.querySelector<HTMLElement>(
          '[data-testid="floater"] [data-tutorial-step]',
        )?.dataset.tutorialStep
        if (startedAt === null && currentStep === expectedStep) startedAt = performance.now()
        if (startedAt !== null) {
          const target = document.querySelector<HTMLElement>(targetSelector)
          const spotlightPath = Array.from(
            document.querySelectorAll<SVGGeometryElement>('[data-testid="spotlight"] path'),
          ).find((path) => path.getAttribute('stroke') === '#38bdf8')
          if (target && spotlightPath) {
            const targetRect = target.getBoundingClientRect()
            const spotlightRect = spotlightPath.getBoundingClientRect()
            const spotlightStyle = getComputedStyle(spotlightPath)
            const opacity = Number(spotlightStyle.opacity)
            const visible = spotlightStyle.visibility !== 'hidden' && opacity > .05
            const mismatch = Math.max(
              Math.abs(spotlightRect.left - (targetRect.left - 8)),
              Math.abs(spotlightRect.top - (targetRect.top - 8)),
              Math.abs(spotlightRect.right - (targetRect.right + 8)),
              Math.abs(spotlightRect.bottom - (targetRect.bottom + 8)),
            )
            if (visible && mismatch > 1) {
              mismatches.push(mismatch)
            }
            if (!visible && Math.abs(window.scrollY - previousScrollY) > .5) {
              hiddenWhileMoving += 1
            }
          }
          previousScrollY = window.scrollY
        }

        if ((startedAt === null && performance.now() < deadline)
          || (startedAt !== null && performance.now() - startedAt < 1_000)) {
          window.requestAnimationFrame(sample)
        } else {
          resolve({ hiddenWhileMoving, mismatches })
        }
      }
      window.requestAnimationFrame(sample)
    }), { selector, step }),
    action(),
  ])
  return transition
}

async function expectDesktopTargetBelowStickyHeader(
  page: Parameters<typeof registerBrowserUser>[0],
  selector: string,
) {
  if ((page.viewportSize()?.width ?? 0) <= 600) return

  const box = await page.locator(selector).boundingBox()
  expect(box, 'desktop tutorial target must have measurable geometry').not.toBeNull()
  expect(box!.y, 'desktop tutorial target must stay below the sticky Tender header').toBeGreaterThanOrEqual(80)
}

async function chooseAccessSlot(
  page: Parameters<typeof registerBrowserUser>[0],
  slot: 4 | 5,
) {
  await page.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
  const confirm = page.getByRole('button', { name: 'Подтвердить выбор' })
  await expectRequiredActionAvailable(page, confirm)
  await confirm.click()
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
  const confirm = page.getByRole('button', { name: 'Подтвердить распределение' })
  await expectRequiredActionAvailable(page, confirm)
  await confirm.click()
}

async function runReconnaissance(page: Parameters<typeof registerBrowserUser>[0]) {
  const target = page.getByRole('button', { name: 'Сигнал для разведки: Неизвестный сигнал A' })
  await target.click()
  await expect(target).toHaveAttribute('aria-pressed', 'true')
  await target.click()
  await expect(target).toHaveAttribute('aria-pressed', 'false')
  await target.press('Enter')
  await expect(target).toHaveAttribute('aria-pressed', 'true')
  const confirm = page.getByRole('button', { name: 'Исследовать' })
  await expectRequiredActionAvailable(page, confirm)
  await confirm.click()
}

async function runLaboratoryTest(
  page: Parameters<typeof registerBrowserUser>[0],
  source: 'Aster' | 'Boreal',
  receiver: 'Boreal' | 'Cinder',
) {
  await page.getByRole('button', { name: `Образец: ${source}` }).click()
  await page.getByRole('button', { name: `Образец: ${receiver}` }).click()
  const confirm = page.getByRole('button', { name: `Провести опыт: ${source} → ${receiver}` })
  await expectRequiredActionAvailable(page, confirm)
  await confirm.click()
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
    await expectCoachAboveDialog(page, page.locator('[data-working-model-dialog]'))
  } else {
    await expectDesktopTargetBelowStickyHeader(
      page,
      `[data-tutorial-working-model-row="${signal.toLowerCase()}"]`,
    )
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
  const confirm = page.getByRole('button', { name: 'Выдвинуть тезис' })
  await expectRequiredActionAvailable(page, confirm)
  await confirm.click()
}

test('completes the two-round tutorial, restores its tab-local step, and records only completion', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await registerBrowserUser(page, 'Ученик E2E', 'tutorial-happy')

  await page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ' }).click()
  await page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию' })
    .getByRole('button', { name: 'Вернуться в главное меню' })
    .click()
  await expect(page).toHaveURL(/\/$/)
  await startTutorial(page)
  await expect(page).toHaveURL(/\/tutorial\/?$/)
  await expect(page.getByRole('button', { name: 'Рабочая модель' })).toBeVisible()
  await expect(page.getByTestId('working-model-table')).toBeHidden()
  await expectCoachWithinViewport(page)
  await completeInitialInterfaceTour(page)
  await expectDimmedControlBlocked(page, page.getByRole('button', { name: /^Слот доступа 1:/ }))
  await chooseAccessSlot(page, 5)
  await expectCoachWithinViewport(page)
  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
  await page.getByRole('button', { name: 'Увеличить мощность: Разведка' }).click()
  await page.getByRole('button', { name: 'Увеличить мощность: Разведка' }).click()
  await page.getByRole('button', { name: 'Увеличить мощность: Анализ модели' }).click()
  await page.getByRole('button', { name: 'Увеличить мощность: Контракты' }).click()
  await page.getByRole('button', { name: 'Подтвердить распределение' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Для этого задания нужно: Разведка 1, Лаборатория 2, Анализ модели 1, Контракты 0.',
  )
  await page.getByRole('button', { name: 'Уменьшить мощность: Разведка' }).click()
  await page.getByRole('button', { name: 'Уменьшить мощность: Контракты' }).click()
  await page.getByRole('button', { name: 'Увеличить мощность: Лаборатория' }).click()
  await page.getByRole('button', { name: 'Увеличить мощность: Лаборатория' }).click()
  await page.getByRole('button', { name: 'Подтвердить распределение' }).click()
  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
  await expect(currentTask(page, tasks.roundOneRecon)).toBeVisible()
  await expectCoachWithinViewport(page)

  await page.reload()
  await expect(currentTask(page, tasks.roundOneRecon)).toBeVisible()
  await expectCoachWithinViewport(page)
  await runReconnaissance(page)
  await expectCoachWithinViewport(page)
  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
  await expect(currentTask(page, tasks.roundOneLabMode)).toBeVisible()
  await expectTutorialFrameFullyVisible(page, '[data-tutorial-lab-modes]')
  await page.getByRole('button', { name: 'Глубокое' }).click()
  await expect(currentTask(page, tasks.roundOneLabPair)).toBeVisible()
  await expectTutorialFrameFullyVisible(page, '[data-tutorial-lab-pair]')
  await runLaboratoryTest(page, 'Aster', 'Boreal')
  await expectCoachWithinViewport(page)

  await expectTutorialFrameFullyVisible(page, '[data-testid="tutorial-research-trigger"]')
  await page.getByTestId('tutorial-research-trigger').click()
  const researchDialog = page.getByRole('dialog', { name: 'Данные исследований' })
  await expectReadingDialogAvailable(page, researchDialog)
  await expectElementDimmed(page, '[aria-label="УЧЕБНЫЙ ТЕНДЕР"] > header')
  await expect(researchDialog).toContainText('Aster')
  await expect(researchDialog).toContainText('Boreal')
  await expect(researchDialog).toContainText('Отражение')
  await expect(researchDialog).toContainText('Одинаковая полярность')
  await page.getByRole('button', { name: 'Закрыть данные исследований' }).click()

  await expect(page.getByText(
    'Верный тезис даёт +1 Рейтинг и личную сертификацию. Ошибка включает вашу персональную проверку.',
    { exact: true },
  )).toBeVisible()
  await expect(page.getByRole('button', { name: 'Справка', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Правила', exact: true })).toBeVisible()
  await expect(currentTask(page, tasks.helpDesktop)).toBeVisible()
  await expectTutorialFrameFullyVisible(page, '[data-tutorial-interpretation-direct]')
  await page.getByRole('button', { name: 'Трактовка анализов', exact: true }).click()
  const interpretationDialog = page.getByRole('dialog', { name: 'Трактовка лабораторных анализов' })
  await expect(interpretationDialog).toContainText('Цикл типов поля')
  await expectReadingDialogAvailable(page, interpretationDialog)
  await expectCoachWithinViewport(page)
  await page.getByRole('button', { name: 'Закрыть трактовку анализов' }).click()

  await expectCoachWithinViewport(page)
  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
  await expectTutorialFrameFullyVisible(page, '[data-tutorial-working-model-row="aster"]')
  await saveHypothesis(page, 'Aster', 'Инерционное')
  await expect(currentTask(page, tasks.roundOneThesis)).toBeVisible()
  await expectCoachWithinViewport(page)
  await submitThesis(page, 'aster', 'inertial')

  await expect(currentTask(page, tasks.thesisResult)).toBeVisible()
  await expectTutorialFrameFullyVisible(page, '[data-testid="tutorial-research-trigger"]')
  await page.getByTestId('tutorial-research-trigger').click()
  const thesisResultDialog = page.getByRole('dialog', { name: 'Данные исследований' })
  await expectReadingDialogAvailable(page, thesisResultDialog)
  await expect(thesisResultDialog).toContainText('Личные тезисы')
  await expect(thesisResultDialog).toContainText('Тип верен')
  await expect(thesisResultDialog).toContainText('Полярность верна')
  await page.getByRole('button', { name: 'Закрыть данные исследований' }).click()

  await expectCoachWithinViewport(page)
  await expect(page.getByRole('button', { name: 'Справка', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Правила', exact: true })).toBeVisible()
  await chooseAccessSlot(page, 4)
  await expectCoachWithinViewport(page)
  await expect(currentTask(page, tasks.contractsReview)).toBeVisible()
  await page.getByTestId('tutorial-contracts-trigger').click()
  const contractsDialog = page.getByRole('dialog', { name: 'Контракты этого раунда · 2' })
  await expectReadingDialogAvailable(page, contractsDialog)
  await expect(contractsDialog.getByText('Готов к подаче', { exact: true })).toBeVisible()
  await expect(contractsDialog.getByText('Нужно подготовить', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть контракты' }).click()
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
  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
  await page.locator('[data-contract-id="tutorial-light-contract"]')
    .getByLabel('Подходящее исследование для контракта Boreal · источник')
    .selectOption('tutorial-test-2')
  await page.getByRole('button', { name: 'Зарезервировать контракт: Boreal · источник' }).click()
  await expect(currentTask(page, tasks.contractBid)).toBeVisible()
  await expectCoachWithinViewport(page)
  await page.getByRole('button', { name: 'Подтвердить контракт: Boreal · источник' }).click()

  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
  await expect(page.getByLabel('Заполнено параметров: 4')).toBeVisible()
  await expect(currentTask(page, tasks.finalModel)).toBeVisible()
  await expectCoachWithinViewport(page, { expectDocumentFits: false })
  await page.getByRole('button', { name: 'Отправить финальную модель' }).click()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  await expect(page.getByText('В настоящем Тендере будет пять раундов', { exact: false })).toBeVisible()
  const finalBackgrounds = await page.evaluate(() => ({
    app: getComputedStyle(document.body, '::before').backgroundImage,
    tutorial: [...document.querySelectorAll<HTMLElement>('*')].filter((element) => (
      getComputedStyle(element).backgroundImage.includes('/assets/home/expedition-')
    )).length,
  }))
  expect(finalBackgrounds.app).toContain('/assets/body-background.webp')
  expect(finalBackgrounds.tutorial, 'completion must not render the tutorial-specific expedition background').toBe(0)

  await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ' }).click()
  await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' })).toBeVisible()
  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(
    page.getByText('Сыграно матчей').locator('..').getByText('0', { exact: true }),
  ).toBeVisible()
})

test('completes the full tutorial on mobile with each action clear of the coach', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 390, height: 840 })
  await registerBrowserUser(page, 'Мобильный ученик E2E', 'tutorial-mobile-interpretation')

  await startTutorial(page)
  await expectCoachWithinViewport(page)
  await completeInitialInterfaceTour(page)
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-access-slot="5"]')
  const initialScrollTransitions: number[][] = []
  await chooseAccessSlot(page, 5)
  initialScrollTransitions.push(await captureScrollTransition(
    page,
    () => page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click(),
  ))
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-power-options]')
  await allocatePower(page, {
    'Разведка': 1,
    'Лаборатория': 2,
    'Анализ модели': 1,
    'Контракты': 0,
  })
  initialScrollTransitions.push(await captureScrollTransition(
    page,
    () => page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click(),
  ))
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-recon-options]')
  await runReconnaissance(page)
  initialScrollTransitions.push(await captureScrollTransition(
    page,
    () => page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click(),
  ))
  expectSmoothAutoScroll(initialScrollTransitions)
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-lab-modes]')
  await page.getByRole('button', { name: 'Глубокое' }).click()
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-lab-pair]')
  const spotlightTransition = await captureVisibleSpotlightMismatchDuringStepChange(
    page,
    'research-results',
    '[data-testid="tutorial-research-trigger"]',
    () => runLaboratoryTest(page, 'Aster', 'Boreal'),
  )
  expect(
    spotlightTransition.mismatches,
    'the tutorial must hide a stale spotlight until mobile autoscroll geometry catches up',
  ).toEqual([])
  expect(
    spotlightTransition.hiddenWhileMoving,
    'the tutorial must keep the spotlight frame hidden while mobile autoscroll is moving it',
  ).toBeGreaterThan(0)

  await expectTargetInMobileInteractiveArea(page, '[data-testid="tutorial-research-trigger"]')
  await waitForScrollToSettle(page)
  await expectSpotlightMatchesTarget(page, '[data-testid="tutorial-research-trigger"]')
  const scrollBeforeResearchDialog = await page.evaluate(() => window.scrollY)
  const researchDialogFrameTransition = await captureVisibleSpotlightMismatchDuringStepChange(
    page,
    'research-results-open',
    '[data-testid="tutorial-research-dialog"]',
    () => page.getByTestId('tutorial-research-trigger').click(),
  )
  expect(
    researchDialogFrameTransition.mismatches,
    'the research dialog spotlight must not visibly jump into place',
  ).toEqual([])
  const mobileResearchDialog = page.getByRole('dialog', { name: 'Данные исследований' })
  await expectReadingDialogAvailable(page, mobileResearchDialog)
  await expect.poll(async () => Math.abs(
    (await page.evaluate(() => window.scrollY)) - scrollBeforeResearchDialog,
  ), {
    message: 'opening a tutorial dialog must not cause a visible page jump',
  }).toBeLessThanOrEqual(12)
  await expect(mobileResearchDialog).toContainText('Отражение')
  const helpMenuScrollRequests = await captureScrollRequests(
    page,
    () => page.getByRole('button', { name: 'Закрыть данные исследований' }).click(),
  )
  const initialHelpMenuRequest = helpMenuScrollRequests[0]
  expect(initialHelpMenuRequest, 'closing research results must scroll to the Help target').toBeDefined()
  const repeatedHelpMenuRequests = helpMenuScrollRequests.slice(1).filter((request) => (
    request.time - initialHelpMenuRequest!.time > 100
      && Math.abs(request.top - initialHelpMenuRequest!.top) < 1
  ))
  expect(
    repeatedHelpMenuRequests,
    'the Help target scroll must not restart while the first smooth movement is active',
  ).toEqual([])

  await page.getByRole('button', { name: 'Справка', exact: true }).click()
  const interpretationDialogFrameTransition = await captureVisibleSpotlightMismatchDuringStepChange(
    page,
    'interpretation-open',
    '[data-testid="tutorial-interpretation-dialog"]',
    () => page.getByRole('button', { name: 'Трактовка анализов', exact: true }).click(),
  )
  expect(
    interpretationDialogFrameTransition.mismatches,
    'step 18 must not show a moving dialog spotlight',
  ).toEqual([])
  const mobileInterpretationDialog = page.getByRole('dialog', { name: 'Трактовка лабораторных анализов' })
  await expect(mobileInterpretationDialog).toBeVisible()
  await expectReadingDialogAvailable(page, mobileInterpretationDialog)
  const interpretationTable = mobileInterpretationDialog.getByRole('table')
  await expect(interpretationTable.getByRole('columnheader', { name: 'Публичный результат' })).toBeVisible()
  const reflectionRow = interpretationTable.getByRole('row').filter({ hasText: 'Отражение' })
  await expect(reflectionRow).toHaveAttribute('aria-current', 'true')
  await expect.poll(async () => reflectionRow.evaluate((row) => {
    const scrollArea = row.closest('[data-interpretation-scroll-area]')
    if (!scrollArea) return false
    const rowRect = row.getBoundingClientRect()
    const scrollRect = scrollArea.getBoundingClientRect()
    return rowRect.top >= scrollRect.top && rowRect.bottom <= scrollRect.bottom
  }), {
    message: 'the tutorial must reveal the highlighted Reflection row without a manual inner swipe',
  }).toBe(true)
  await expect.poll(async () => interpretationTable.evaluate((table) => {
    const scrollArea = table.parentElement
    return scrollArea ? scrollArea.scrollWidth - scrollArea.clientWidth : Number.POSITIVE_INFINITY
  })).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Закрыть трактовку анализов' }).click()

  await expect(page.getByText('Правила игры и трактовка результатов исследований.', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
  await expect(page.getByRole('button', { name: 'Рабочая модель' })).toBeEnabled()
  await expect(page.getByTestId('floater').getByText('Откройте Рабочую модель', { exact: false })).toBeVisible()
  await expectTargetInMobileInteractiveArea(
    page,
    '[data-tutorial-working-model-trigger]',
    'below-coach',
  )
  await expect(currentTask(page, tasks.roundOneModel)).toBeVisible()
  await saveHypothesis(page, 'Aster', 'Инерционное')

  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-thesis]')
  await expect(currentTask(page, tasks.roundOneThesis)).toBeVisible()
  await submitThesis(page, 'aster', 'inertial')
  await expectTargetInMobileInteractiveArea(page, '[data-testid="tutorial-research-trigger"]')
  await page.getByTestId('tutorial-research-trigger').click()
  const mobileThesisDialog = page.getByRole('dialog', { name: 'Данные исследований' })
  await expectReadingDialogAvailable(page, mobileThesisDialog)
  await expect(mobileThesisDialog).toContainText('Тип верен')
  await page.getByRole('button', { name: 'Закрыть данные исследований' }).click()

  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-access-options]')
  await chooseAccessSlot(page, 4)
  await expectTargetInMobileInteractiveArea(page, '[data-testid="tutorial-contracts-trigger"]')
  await page.getByTestId('tutorial-contracts-trigger').click()
  const mobileContractsDialog = page.getByRole('dialog', { name: 'Контракты этого раунда · 2' })
  await expectReadingDialogAvailable(page, mobileContractsDialog)
  await expect(mobileContractsDialog.getByText('Готов к подаче', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть контракты' }).click()

  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-power-options]')
  await allocatePower(page, {
    'Разведка': 1,
    'Лаборатория': 1,
    'Анализ модели': 1,
    'Контракты': 1,
  })
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-recon-options]')
  await runReconnaissance(page)
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-lab-options]')
  await runLaboratoryTest(page, 'Boreal', 'Cinder')

  await expectTargetInMobileInteractiveArea(
    page,
    '[data-tutorial-working-model-trigger]',
    'below-coach',
  )
  await expect(currentTask(page, tasks.roundTwoModel)).toBeVisible()
  await page.getByRole('button', { name: 'Рабочая модель' }).click()
  await page.getByRole('button', { name: 'Boreal: гипотеза, тип поля Фазовое' }).click()
  await page.getByRole('button', { name: 'Boreal: гипотеза, полярность Положительная' }).click()
  const modelCheckFeedback = page.locator('[data-working-model-dialog]').getByRole('alert')
  await expect(modelCheckFeedback).toHaveText(
    'Пока не сходится. «Отражение» означает следующий тип в цикле, а одинаковая полярность сохраняет знак Aster. Проверьте Boreal ещё раз.',
  )
  await expect(modelCheckFeedback).toBeVisible()
  await expect.poll(async () => modelCheckFeedback.evaluate((feedback) => {
    const rect = feedback.getBoundingClientRect()
    return rect.top >= 0 && rect.bottom <= window.innerHeight
  }), {
    message: 'the independent-model feedback must be visible without an extra mobile swipe',
  }).toBe(true)
  await expect(page.locator('[data-working-model-dialog]')).toBeVisible()
  await page.getByRole('button', { name: 'Boreal: гипотеза, тип поля Электромагнитное' }).click()
  await expectTargetInMobileInteractiveArea(page, '[data-tutorial-thesis]')
  await expect(currentTask(page, tasks.roundTwoThesis)).toBeVisible()
  await submitThesis(page, 'boreal', 'electromagnetic')

  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
  await expectTargetInMobileInteractiveArea(page, '[data-contract-id="tutorial-light-contract"]')
  await page.locator('[data-contract-id="tutorial-light-contract"]')
    .getByLabel('Подходящее исследование для контракта Boreal · источник')
    .selectOption('tutorial-test-2')
  await page.getByRole('button', { name: 'Зарезервировать контракт: Boreal · источник' }).click()
  await expectTargetInMobileInteractiveArea(page, '[data-contract-id="tutorial-light-contract"]')
  const finalIntroScrollRequests = await captureScrollRequests(
    page,
    () => page.getByRole('button', { name: 'Подтвердить контракт: Boreal · источник' }).click(),
  )
  expect(finalIntroScrollRequests, 'step 35 must not scroll an oversized target').toEqual([])

  await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
  await expect(page.getByLabel('Заполнено параметров: 4')).toBeVisible()
  await expectRequiredActionAvailable(page, page.getByRole('button', { name: 'Отправить финальную модель' }))
  let completionAttempts = 0
  await page.route('**/api/profile/tutorial/completion', async (route) => {
    completionAttempts += 1
    await route.fulfill({
      contentType: 'application/json',
      status: 503,
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary failure' } }),
    })
  })
  await page.getByRole('button', { name: 'Отправить финальную модель' }).click()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeHidden()
  await expect(page.getByRole('alert')).toContainText('отметку об обучении пока не удалось сохранить')
  expect(completionAttempts).toBe(1)
  await page.unroute('**/api/profile/tutorial/completion')
  await page.getByRole('button', { name: 'Сохранить отметку' }).click()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
})

test('exits the tutorial through its confirmation dialog and clears the saved step', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await registerBrowserUser(page, 'Выходящий ученик E2E', 'tutorial-exit')

  await startTutorial(page)
  await completeInitialInterfaceTour(page)
  await page.getByRole('button', { name: /^Слот доступа 5:/ }).click()

  await page.getByTestId('floater').getByRole('button', { name: 'Выйти из обучения' }).click()
  const exitDialog = page.getByRole('dialog', { name: 'Выйти из обучения?' })
  await expect(exitDialog).toBeVisible()
  await expect.poll(() => exitDialog.evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect()
    const hit = document.elementFromPoint(
      rect.left + rect.width * .3,
      rect.top + rect.height * .35,
    )
    return hit !== null && dialog.contains(hit)
  })).toBe(true)
  await exitDialog.getByRole('button', { name: 'Выйти и сбросить' }).click()

  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ' }).click()
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию' })).toBeVisible()
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
