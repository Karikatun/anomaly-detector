import {
  adminOverviewSchema,
  apiErrorSchema,
  cookieAuthResponseSchema,
  cookieRefreshResponseSchema,
  loginRequestSchema,
  type AdminOverview,
  type LoginRequest,
  type UserDto,
} from '@anomaly-detector/contracts'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class AdminApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class AdminApi {
  private accessToken: string | null = null
  private restorePromise: Promise<void> | null = null
  private readonly baseUrl: string
  private readonly fetcher: Fetcher

  constructor(baseUrl = '', fetcher: Fetcher = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetcher = fetcher
  }

  async restoreSession(): Promise<void> {
    if (this.restorePromise) return this.restorePromise

    this.restorePromise = this.performSessionRestore().finally(() => {
      this.restorePromise = null
    })
    return this.restorePromise
  }

  private async performSessionRestore(): Promise<void> {
    const response = await this.request('/api/auth/refresh', {
      method: 'POST',
      body: {},
    })
    const data = cookieRefreshResponseSchema.parse(await response.json())
    this.accessToken = data.accessToken
  }

  async login(input: LoginRequest): Promise<UserDto> {
    const response = await this.request('/api/auth/login', {
      method: 'POST',
      body: loginRequestSchema.parse(input),
    })
    const data = cookieAuthResponseSchema.parse(await response.json())
    this.accessToken = data.accessToken
    return data.user
  }

  async logout(): Promise<void> {
    await this.request('/api/auth/logout', { method: 'POST', body: {} })
    this.accessToken = null
  }

  async getOverview(page = 1): Promise<AdminOverview> {
    const headers = new Headers()
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`)
    const query = new URLSearchParams({ page: String(page), pageSize: '20' })
    const response = await this.request(`/api/operations/overview?${query}`, { headers })
    return adminOverviewSchema.parse(await response.json())
  }

  private async request(
    path: string,
    options: { body?: unknown; headers?: HeadersInit; method?: 'GET' | 'POST' } = {},
  ) {
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include',
      headers,
      method: options.method ?? 'GET',
    })

    if (response.ok) return response

    const parsed = apiErrorSchema.safeParse(await response.clone().json().catch(() => undefined))
    const code = parsed.success ? parsed.data.error.code : 'INTERNAL_ERROR'
    const message = response.status === 404
      ? 'Ресурс недоступен'
      : parsed.success
        ? parsed.data.error.message
        : `Request failed with status ${response.status}`
    throw new AdminApiError(response.status, code, message)
  }
}
