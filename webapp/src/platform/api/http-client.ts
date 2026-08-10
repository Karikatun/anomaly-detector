import { apiErrorSchema } from '@anomaly-detector/contracts'
import type { z } from 'zod'

import { getApiBaseUrl } from './api-base-url'

export type HttpRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: HeadersInit
  credentials?: RequestCredentials
  signal?: AbortSignal
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class HttpClient {
  private readonly baseUrl: string

  constructor(baseUrl = getApiBaseUrl()) {
    this.baseUrl = baseUrl
  }

  async request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options: HttpRequestOptions = {},
  ): Promise<z.infer<TSchema>> {
    const response = await this.raw(path, options)
    if (response.status === 204) {
      throw new ApiRequestError(response.status, 'INVALID_RESPONSE', 'Expected a JSON response')
    }
    return schema.parse(await response.json())
  }

  async requestNoContent(path: string, options: HttpRequestOptions = {}): Promise<void> {
    const response = await this.raw(path, options)
    if (response.status !== 204) {
      throw new ApiRequestError(response.status, 'INVALID_RESPONSE', 'Expected a no-content response')
    }
  }

  async raw(path: string, options: HttpRequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers)
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: options.credentials ?? 'include',
      headers,
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    if (!response.ok) {
      throw await toApiError(response)
    }

    return response
  }
}

async function toApiError(response: Response) {
  const fallbackMessage = `Request failed with status ${response.status}`

  try {
    const parsed = apiErrorSchema.parse(await response.json())
    return new ApiRequestError(response.status, parsed.error.code, parsed.error.message)
  } catch {
    return new ApiRequestError(response.status, 'INTERNAL_ERROR', fallbackMessage)
  }
}
