import {
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  loginRequestSchema,
  meResponseSchema,
  oauthStartRequestSchema,
  oauthStartResponseSchema,
  registerRequestSchema,
  updateProfileSchema,
  type CookieAuthResponse,
  type CookieRefreshResponse,
  type LoginRequest,
  type MeResponse,
  type OAuthProviderId,
  type OAuthStartRequest,
  type UpdateProfileRequest,
  type RegisterRequest,
} from '@anomaly-detector/contracts'
import { z } from 'zod'
import { ApiRequestError, getOAuthApiBaseUrl, HttpClient, type HttpRequestOptions } from '@/platform/api'
import {
  coordinateBrowserAuthMutation,
  type BrowserAuthCoordinator,
} from './browser-auth-coordinator'
import {
  currentBrowserSessionEpoch,
  isBrowserSessionEpochCurrent,
  publishBrowserSessionState,
} from './session-coordinator'

export type BrowserSessionTransition<T> = {
  data: T
  sessionEpoch: string
}

type AuthApiOptions = {
  getAccessToken: () => string | null
  setAccessToken: (accessToken: string | null) => void
  onAuthExpired?: () => void | Promise<void>
  authCoordinator?: BrowserAuthCoordinator
}

class BrowserSessionEpochChangedError extends Error {}

export class AuthApi {
  private readonly options: AuthApiOptions
  private readonly http: HttpClient
  private readonly oauthHttp: HttpClient
  private readonly authCoordinator: BrowserAuthCoordinator
  private readonly sessionEpoch: string
  private refreshInFlight: {
    epoch: string
    promise: Promise<CookieRefreshResponse>
  } | null = null

  constructor(options: AuthApiOptions, http = new HttpClient(), oauthHttp = new HttpClient(getOAuthApiBaseUrl())) {
    this.options = options
    this.http = http
    this.oauthHttp = oauthHttp
    this.authCoordinator = options.authCoordinator ?? coordinateBrowserAuthMutation
    this.sessionEpoch = currentBrowserSessionEpoch()
  }

  register(input: RegisterRequest): Promise<BrowserSessionTransition<CookieAuthResponse>> {
    const payload = registerRequestSchema.parse(input)
    return this.authCoordinator(async () => {
      const data = await this.http.request('/api/auth/register', cookieAuthResponseSchema, {
        method: 'POST',
        body: payload,
      })
      const sessionEvent = publishBrowserSessionState('authenticated')
      return { data, sessionEpoch: sessionEvent.epoch }
    })
  }

  login(input: LoginRequest): Promise<BrowserSessionTransition<CookieAuthResponse>> {
    const payload = loginRequestSchema.parse(input)
    return this.authCoordinator(async () => {
      const data = await this.http.request('/api/auth/login', cookieAuthResponseSchema, {
        method: 'POST',
        body: payload,
      })
      const sessionEvent = publishBrowserSessionState('authenticated')
      return { data, sessionEpoch: sessionEvent.epoch }
    })
  }

  refresh(expectedEpoch = this.sessionEpoch): Promise<CookieRefreshResponse> {
    if (this.refreshInFlight?.epoch === expectedEpoch) return this.refreshInFlight.promise

    const refreshPromise = this.authCoordinator(async () => {
      if (!this.isSessionEpochCurrent(expectedEpoch)) {
        throw new BrowserSessionEpochChangedError('Browser auth session changed')
      }

      const payload = cookieRefreshRequestSchema.parse({})
      try {
        return await this.http.request('/api/auth/refresh', cookieRefreshResponseSchema, {
          method: 'POST',
          body: payload,
        })
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          await this.expireSessionWithinMutation(expectedEpoch)
        }
        throw error
      }
    })
    const trackedPromise = refreshPromise.finally(() => {
      if (this.refreshInFlight?.promise === trackedPromise) this.refreshInFlight = null
    })
    this.refreshInFlight = { epoch: expectedEpoch, promise: trackedPromise }

    return trackedPromise
  }

  me(): Promise<MeResponse> {
    return this.requestAuthenticated('/api/auth/me', meResponseSchema)
  }

  logout(): Promise<BrowserSessionTransition<undefined> | null> {
    return this.authCoordinator(async () => {
      if (!this.isSessionEpochCurrent(this.sessionEpoch)) return null

      const payload = cookieLogoutRequestSchema.parse({})
      await this.http.requestNoContent('/api/auth/logout', {
        method: 'POST',
        body: payload,
      })
      const sessionEvent = publishBrowserSessionState('cleared')
      this.options.setAccessToken(null)
      return { data: undefined, sessionEpoch: sessionEvent.epoch }
    })
  }

  deleteAccount(): Promise<BrowserSessionTransition<undefined> | null> {
    return this.authCoordinator(async () => {
      if (!this.isSessionEpochCurrent(this.sessionEpoch)) return null

      await this.requestAuthenticatedNoContent('/api/auth/account', {
        method: 'DELETE',
      })
      const sessionEvent = publishBrowserSessionState('cleared')
      this.options.setAccessToken(null)
      return { data: undefined, sessionEpoch: sessionEvent.epoch }
    })
  }

  async clearSession() {
    return this.authCoordinator(() => this.expireSessionWithinMutation(this.sessionEpoch))
  }

  async startOAuth(
    provider: OAuthProviderId,
    registration?: OAuthStartRequest['registration'],
  ): Promise<void> {
    const payload = oauthStartRequestSchema.parse({
      registration,
      webappOrigin: window.location.origin,
    })
    const response = await this.oauthHttp.request(
      `/api/auth/oauth/${provider}/start`,
      oauthStartResponseSchema,
      { method: 'POST', body: payload },
    )
    window.location.href = response.authorizationUrl
  }

  async updateProfile(input: UpdateProfileRequest): Promise<void> {
    const payload = updateProfileSchema.parse(input)
    await this.requestAuthenticatedNoContent('/api/auth/profile', {
      method: 'PATCH',
      body: payload,
    })
  }

  isSessionEpochCurrent(epoch: string) {
    return isBrowserSessionEpochCurrent(epoch)
  }

  async requestAuthenticated<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options: HttpRequestOptions = {},
  ): Promise<z.infer<TSchema>> {
    return this.performAuthenticated(
      (headers) => this.http.request(path, schema, { ...options, headers }),
      options.headers,
    )
  }

  requestAuthenticatedNoContent(
    path: string,
    options: HttpRequestOptions = {},
  ): Promise<void> {
    return this.performAuthenticated(
      (headers) => this.http.requestNoContent(path, { ...options, headers }),
      options.headers,
    )
  }

  private async performAuthenticated<TResult>(
    request: (headers: Headers) => Promise<TResult>,
    baseHeaders?: HeadersInit,
    accessTokenOverride?: string,
  ): Promise<TResult> {
    const requestEpoch = this.sessionEpoch
    const accessToken = accessTokenOverride ?? this.options.getAccessToken()
    const headers = new Headers(baseHeaders)
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

    try {
      const response = await request(headers)
      if (!this.isSessionEpochCurrent(requestEpoch)) {
        throw new BrowserSessionEpochChangedError('Browser auth session changed')
      }
      return response
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 401 || accessTokenOverride) {
        throw error
      }

      if (!this.isSessionEpochCurrent(requestEpoch)) throw error

      let refreshed: CookieRefreshResponse
      try {
        refreshed = await this.refresh(requestEpoch)
      } catch (refreshError) {
        if (refreshError instanceof BrowserSessionEpochChangedError) throw error
        throw refreshError
      }
      if (!this.isSessionEpochCurrent(requestEpoch)) throw error
      if (!accessToken || !hasSamePrincipal(accessToken, refreshed.accessToken)) {
        this.options.setAccessToken(null)
        await this.options.onAuthExpired?.()
        throw error
      }

      this.options.setAccessToken(refreshed.accessToken)
      return this.performAuthenticated(request, baseHeaders, refreshed.accessToken)
    }
  }

  private async expireSessionWithinMutation(expectedEpoch: string) {
    if (!this.isSessionEpochCurrent(expectedEpoch)) return false

    publishBrowserSessionState('cleared')
    this.options.setAccessToken(null)
    await this.options.onAuthExpired?.()
    return true
  }
}

function hasSamePrincipal(currentAccessToken: string, nextAccessToken: string) {
  const currentSubject = accessTokenSubject(currentAccessToken)
  const nextSubject = accessTokenSubject(nextAccessToken)
  return currentSubject !== null && currentSubject === nextSubject
}

function accessTokenSubject(accessToken: string) {
  const payload = accessToken.split('.')[1]
  if (!payload) return null

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown }
    return typeof decoded.sub === 'string' ? decoded.sub : null
  } catch {
    return null
  }
}
