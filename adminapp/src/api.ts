import {
  analyticsAdminOverviewSchema,
  analyticsAdminQuerySchema,
  adminOverviewSchema,
  apiErrorSchema,
  cookieAuthResponseSchema,
  cookieRefreshResponseSchema,
  feedbackDeleteContactCommandSchema,
  feedbackOperatorCommandResponseSchema,
  feedbackQueueQuerySchema,
  feedbackQueueResponseSchema,
  feedbackRecordGithubIssueCommandSchema,
  feedbackRejectCommandSchema,
  feedbackResolveCommandSchema,
  feedbackTakeCommandSchema,
  loginRequestSchema,
  mailPolicySyncCommandSchema,
  mailPolicyStatusCommandSchema,
  mailOperationsViewSchema,
  requestBudgetOverviewSchema,
  type AdminOverview,
  type AnalyticsAdminOverview,
  type FeedbackDeleteContactCommand,
  type FeedbackOperatorCommandResponse,
  type FeedbackQueueQuery,
  type FeedbackQueueResponse,
  type FeedbackRecordGithubIssueCommand,
  type FeedbackRejectCommand,
  type FeedbackResolveCommand,
  type FeedbackTakeCommand,
  type LoginRequest,
  type MailPolicySyncCommand,
  type MailPolicyStatusCommand,
  type MailOperationsView,
  type RequestBudgetOverview,
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

  constructor(baseUrl = '', fetcher: Fetcher = (input, init) => globalThis.fetch(input, init)) {
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
    const query = new URLSearchParams({ page: String(page), pageSize: '20' })
    const response = await this.request(`/api/operations/overview?${query}`, {
      headers: this.authenticatedHeaders(),
    })
    return adminOverviewSchema.parse(await response.json())
  }

  async getAnalytics(windowDays: 7 | 30 | 90): Promise<AnalyticsAdminOverview> {
    const query = analyticsAdminQuerySchema.parse({ windowDays })
    const search = new URLSearchParams({ windowDays: String(query.windowDays) })
    const response = await this.request(`/api/operations/analytics?${search}`, {
      headers: this.authenticatedHeaders(),
    })
    return analyticsAdminOverviewSchema.parse(await response.json())
  }

  async getMailPolicy(): Promise<MailOperationsView> {
    const response = await this.request('/api/operations/mail-policy', {
      headers: this.authenticatedHeaders(),
    })
    return mailOperationsViewSchema.parse(await response.json())
  }

  async getMailPolicyAntiAbuse(): Promise<RequestBudgetOverview> {
    const response = await this.request('/api/operations/mail-policy/anti-abuse', {
      headers: this.authenticatedHeaders(),
    })
    return requestBudgetOverviewSchema.parse(await response.json())
  }

  async getMailPolicyWorkspace(): Promise<{
    antiAbuse: RequestBudgetOverview | null
    mailPolicy: MailOperationsView
  }> {
    const mailPolicy = await this.getMailPolicy()
    try {
      return { antiAbuse: await this.getMailPolicyAntiAbuse(), mailPolicy }
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 404) {
        return { antiAbuse: null, mailPolicy }
      }
      throw error
    }
  }

  async getFeedbackQueue(input: FeedbackQueueQuery): Promise<FeedbackQueueResponse> {
    const query = feedbackQueueQuerySchema.parse(input)
    const search = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
    })
    const response = await this.request(`/api/operations/feedback?${search}`, {
      headers: this.authenticatedHeaders(),
    })
    return feedbackQueueResponseSchema.parse(await response.json())
  }

  takeFeedback(reportId: string, input: FeedbackTakeCommand) {
    return this.feedbackCommand(
      `/api/operations/feedback/${reportId}/take`,
      feedbackTakeCommandSchema.parse(input),
    )
  }

  resolveFeedback(reportId: string, input: FeedbackResolveCommand) {
    return this.feedbackCommand(
      `/api/operations/feedback/${reportId}/resolve`,
      feedbackResolveCommandSchema.parse(input),
    )
  }

  rejectFeedback(reportId: string, input: FeedbackRejectCommand) {
    return this.feedbackCommand(
      `/api/operations/feedback/${reportId}/reject`,
      feedbackRejectCommandSchema.parse(input),
    )
  }

  recordFeedbackGithubIssue(reportId: string, input: FeedbackRecordGithubIssueCommand) {
    return this.feedbackCommand(
      `/api/operations/feedback/${reportId}/github-issue`,
      feedbackRecordGithubIssueCommandSchema.parse(input),
    )
  }

  deleteFeedbackContact(reportId: string, input: FeedbackDeleteContactCommand) {
    return this.feedbackCommand(
      `/api/operations/feedback/${reportId}/contact/delete`,
      feedbackDeleteContactCommandSchema.parse(input),
    )
  }

  async syncMailPolicyCatalog(input: MailPolicySyncCommand): Promise<MailOperationsView> {
    return this.mailPolicyCommand('/api/operations/mail-policy/sync', mailPolicySyncCommandSchema.parse(input))
  }

  async changeMailPolicyStatus(input: MailPolicyStatusCommand): Promise<MailOperationsView> {
    return this.mailPolicyCommand('/api/operations/mail-policy/status', mailPolicyStatusCommandSchema.parse(input))
  }

  private async mailPolicyCommand(path: string, body: unknown) {
    const response = await this.request(path, {
      body,
      headers: this.authenticatedHeaders(),
      method: 'POST',
    })
    return mailOperationsViewSchema.parse(await response.json())
  }

  private async feedbackCommand(
    path: string,
    body: unknown,
  ): Promise<FeedbackOperatorCommandResponse> {
    const response = await this.request(path, {
      body,
      headers: this.authenticatedHeaders(),
      method: 'POST',
    })
    return feedbackOperatorCommandResponseSchema.parse(await response.json())
  }

  private authenticatedHeaders() {
    const headers = new Headers()
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`)
    return headers
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
