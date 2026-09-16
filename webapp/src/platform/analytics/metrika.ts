export const METRIKA_GOALS = [
  'tutorial_cta',
  'login_cta',
  'tutorial_complete',
  'registration_complete',
  'login_success',
] as const

export type MetrikaGoal = typeof METRIKA_GOALS[number]
const approvedMetrikaCounterId = '112719766'
export const metrikaOAuthPendingStorageKey = 'anomaly-detector:metrika-oauth-pending'

type MetrikaStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>
let inMemoryMetrikaOAuthPending: {
  storage: MetrikaStorage | undefined
  value: string
} | null = null

type MetrikaCommand = ((counterId: number, method: 'init' | 'reachGoal', ...args: unknown[]) => void) & {
  a?: unknown[][]
}
type MetrikaWindow = {
  ym?: MetrikaCommand
  location?: { pathname: string; search: string; hash: string }
  history?: { state: unknown; replaceState: (state: unknown, unused: string, url?: string) => void }
}
type MetrikaDocument = {
  createElement: (tagName: string) => { async?: boolean; src?: string }
  head?: { appendChild: (element: { async?: boolean; src?: string }) => void }
}

const metrikaInitOptions = {
  accurateTrackBounce: true,
  clickmap: false,
  defer: true,
  ecommerce: false,
  sendTitle: false,
  trackLinks: false,
  webvisor: false,
} as const

export function sanitizeMetrikaCounterId(value: string | undefined) {
  return value === approvedMetrikaCounterId ? value : undefined
}

export function isMetrikaSafePath(pathname: string) {
  return pathname === '/' || pathname === '/learn'
}

export function isMetrikaOAuthLoginSuccess(search: string) {
  return new URLSearchParams(search).get('analytics_registration') !== '1'
}

export function isMetrikaOAuthRegistration(search: string, pending: string | null) {
  return new URLSearchParams(search).get('analytics_registration') === '1'
    && pending?.startsWith('registration:') === true
}

export function writeMetrikaOAuthPending(value: string, storage = browserSessionStorage()) {
  try {
    if (!storage) throw new Error('session storage unavailable')
    storage.setItem(metrikaOAuthPendingStorageKey, value)
    if (inMemoryMetrikaOAuthPending?.storage === storage) inMemoryMetrikaOAuthPending = null
  } catch {
    inMemoryMetrikaOAuthPending = { storage, value }
    // Analytics state must not block authentication when storage is unavailable.
  }
}

export function readMetrikaOAuthPending(storage = browserSessionStorage()) {
  try {
    const stored = storage?.getItem(metrikaOAuthPendingStorageKey)
    if (stored !== null && stored !== undefined) {
      if (inMemoryMetrikaOAuthPending?.storage === storage) inMemoryMetrikaOAuthPending = null
      return stored
    }
    return inMemoryPendingFor(storage)
  } catch {
    return inMemoryPendingFor(storage)
  }
}

export function clearMetrikaOAuthPending(
  storage = browserSessionStorage(),
  expectedValue?: string,
) {
  if (expectedValue !== undefined && readMetrikaOAuthPending(storage) !== expectedValue) return
  if (inMemoryMetrikaOAuthPending?.storage === storage) inMemoryMetrikaOAuthPending = null
  try {
    storage?.removeItem(metrikaOAuthPendingStorageKey)
  } catch {
    // Analytics state is best effort and may be unavailable in restricted browsers.
  }
}

function inMemoryPendingFor(storage: MetrikaStorage | undefined) {
  const memory = inMemoryMetrikaOAuthPending
  if (!memory || memory.storage !== storage) return null
  return memory.value
}

export class MetrikaClient {
  private readonly counterId: number
  private readonly document: MetrikaDocument | undefined
  private readonly enabled: boolean
  private readonly onCommand: ((...args: unknown[]) => void) | undefined
  private readonly window: MetrikaWindow | undefined
  private readonly sentGoals = new Set<string>()
  private command: MetrikaCommand | undefined
  private initialized = false

  constructor(input: {
    counterId: string
    document?: MetrikaDocument
    enabled: boolean
    onCommand?: (...args: unknown[]) => void
    window?: MetrikaWindow
  }) {
    this.counterId = Number(input.counterId)
    this.document = input.document ?? browserDocument()
    this.enabled = input.enabled && Number.isSafeInteger(this.counterId)
    this.onCommand = input.onCommand
    this.window = input.window ?? browserWindow()
  }

  enable() {
    if (!this.enabled || this.initialized || !this.isSafePath()) return
    this.initialized = true
    this.stripLocationSuffix()
    this.command = this.window?.ym ?? this.createQueue()
    if (this.window && !this.window.ym) this.window.ym = this.command
    this.dispatch('init', metrikaInitOptions)

    const script = this.document?.createElement('script')
    if (!script || !this.document?.head) return
    script.async = true
    script.src = 'https://mc.yandex.ru/metrika/tag.js'
    this.document.head.appendChild(script)
  }

  record(goal: MetrikaGoal, dedupeKey: string = goal) {
    const eventKey = `${goal}:${dedupeKey}`
    if (!this.initialized || !this.isSafePath() || !METRIKA_GOALS.includes(goal) || this.sentGoals.has(eventKey)) return
    this.sentGoals.add(eventKey)
    this.dispatch('reachGoal', goal)
  }

  private createQueue(): MetrikaCommand {
    const queue = ((...args: unknown[]) => {
      queue.a?.push(args)
    }) as MetrikaCommand
    queue.a = []
    return queue
  }

  private dispatch(method: 'init' | 'reachGoal', ...args: unknown[]) {
    this.onCommand?.(this.counterId, method, ...args)
    this.command?.(this.counterId, method, ...args)
  }

  private stripLocationSuffix() {
    const location = this.window?.location
    const history = this.window?.history
    if (!location || !history || (!location.search && !location.hash)) return
    history.replaceState(history.state, '', location.pathname)
  }

  private isSafePath() {
    const pathname = this.window?.location?.pathname
    return typeof pathname === 'string' && isMetrikaSafePath(pathname)
  }
}

const configuredCounterId = sanitizeMetrikaCounterId(import.meta.env?.VITE_METRIKA_COUNTER_ID)

export const metrikaConfigured = configuredCounterId !== undefined

export const metrika = new MetrikaClient({
  counterId: configuredCounterId ?? '',
  enabled: configuredCounterId !== undefined,
})

function browserDocument(): MetrikaDocument | undefined {
  return typeof document === 'undefined' ? undefined : document as unknown as MetrikaDocument
}

function browserWindow(): MetrikaWindow | undefined {
  return typeof window === 'undefined' ? undefined : window as unknown as MetrikaWindow
}

function browserSessionStorage(): MetrikaStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}
