import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  legacyRouteMatchers,
  localizeRedirectPolicy,
  redirectPolicy,
  siteBlock,
} from './split-domain-caddy-policy.mjs'
import { createEphemeralTlsCertificate } from './split-domain-tls.mjs'

const mode = process.env.E2E_SPLIT_DOMAIN_MODE
if (mode !== 'target' && mode !== 'rollback') {
  throw new Error('E2E_SPLIT_DOMAIN_MODE must be target or rollback')
}

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = resolve(frontendRoot, '..')
const targetCaddyfile = readFileSync(
  resolve(repositoryRoot, 'deploy/yandex/Caddyfile.example'),
  'utf8',
)
const rollbackCaddyfile = readFileSync(
  resolve(repositoryRoot, 'deploy/yandex/Caddyfile.split-domain-rollback.example'),
  'utf8',
)

const edgePort = requiredPort('E2E_EDGE_PORT')
const backendUpstream = requiredUrl('E2E_BACKEND_URL')
const webUpstream = requiredUrl('E2E_WEB_URL')
const websiteUpstream = mode === 'target' ? requiredUrl('E2E_WEBSITE_URL') : null
const rootOrigin = requiredUrl('E2E_SPLIT_ROOT_ORIGIN')
const appOrigin = requiredUrl('E2E_SPLIT_APP_ORIGIN')
const apiOrigin = requiredUrl('E2E_SPLIT_API_ORIGIN')
const untrustedOrigin = requiredUrl('E2E_SPLIT_UNTRUSTED_ORIGIN')
const wwwOrigin = requiredUrl('E2E_SPLIT_WWW_ORIGIN')

const rootHost = new URL(rootOrigin).hostname
const appHost = new URL(appOrigin).hostname
const apiHost = new URL(apiOrigin).hostname
const untrustedHost = new URL(untrustedOrigin).hostname
const wwwHost = new URL(wwwOrigin).hostname
const legacyPlayerRoutes = legacyRouteMatchers(targetCaddyfile)

const targetPublicBlock = siteBlock(targetCaddyfile, 'anomaly-detector.ru')
const targetPlayerBlock = siteBlock(targetCaddyfile, 'app.anomaly-detector.ru')
const targetWwwBlock = siteBlock(targetCaddyfile, 'www.anomaly-detector.ru')
const rollbackRootBlock = siteBlock(rollbackCaddyfile, 'anomaly-detector.ru')
const rollbackAppBlock = siteBlock(rollbackCaddyfile, 'app.anomaly-detector.ru')
const rollbackWwwBlock = siteBlock(rollbackCaddyfile, 'www.anomaly-detector.ru')
const localOrigins = {
  'https://anomaly-detector.ru': rootOrigin,
  'https://app.anomaly-detector.ru': appOrigin,
}
const targetLegacyRedirect = localizeRedirectPolicy(
  redirectPolicy(targetPublicBlock, '@legacyPlayerRoutes'),
  localOrigins,
)
const targetWwwRedirect = localizeRedirectPolicy(redirectPolicy(targetWwwBlock), localOrigins)
const rollbackAppRedirect = localizeRedirectPolicy(redirectPolicy(rollbackAppBlock), localOrigins)
const rollbackWwwRedirect = localizeRedirectPolicy(redirectPolicy(rollbackWwwBlock), localOrigins)
const tlsCertificate = createEphemeralTlsCertificate()
process.once('exit', tlsCertificate.cleanup)

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: edgePort,
  tls: tlsCertificate.tls,
  async fetch(request) {
    const requestUrl = new URL(request.url)
    if (requestUrl.pathname === '/__ready') return new Response('ready')

    const hostname = request.headers.get('host')?.replace(/:\d+$/, '') ?? ''
    if (requestUrl.pathname.endsWith('/_cookie-echo')) {
      const cookieNames = (request.headers.get('cookie') ?? '')
        .split(';')
        .map((cookie) => cookie.trim().split('=', 1)[0])
        .filter(Boolean)
      return Response.json({ cookieNames })
    }

    if (hostname === apiHost) {
      return proxy(request, backendUpstream)
    }

    if (hostname === untrustedHost) {
      return new Response('<!doctype html><title>Untrusted CORS probe</title>', {
        headers: {
          'Content-Security-Policy': `default-src 'self'; connect-src 'self' ${apiOrigin}`,
          'Content-Type': 'text/html; charset=utf-8',
        },
      })
    }

    if (hostname === wwwHost) {
      return redirectWithUri(
        mode === 'target' ? targetWwwRedirect : rollbackWwwRedirect,
        requestUrl,
      )
    }

    if (mode === 'target') {
      if (hostname === rootHost) {
        if (legacyPlayerRoutes.some((route) => route.test(requestUrl.pathname))) {
          return redirectWithUri(targetLegacyRedirect, requestUrl)
        }
        return proxy(request, websiteUpstream, targetPublicBlock)
      }

      if (hostname === appHost) {
        return proxy(request, webUpstream, targetPlayerBlock)
      }
    } else {
      if (hostname === rootHost) {
        return proxy(request, webUpstream, rollbackRootBlock)
      }

      if (hostname === appHost) {
        return redirectWithUri(rollbackAppRedirect, requestUrl)
      }
    }

    return new Response('Unknown isolated split-domain host', { status: 404 })
  },
})

console.log(`Split-domain ${mode} edge listening on ${server.url}`)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.stop(true)
    tlsCertificate.cleanup()
    process.exit(0)
  })
}

function requiredPort(name) {
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must be a valid port`)
  }
  return value
}

function requiredUrl(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return new URL(value).origin
}

function redirectWithUri(policy, requestUrl) {
  const destination = new URL(requestUrl.pathname + requestUrl.search, policy.destinationOrigin)
  const headers = new Headers({ Location: destination.toString() })
  if (policy.cacheControl) headers.set('Cache-Control', policy.cacheControl)
  return new Response(null, {
    status: policy.status,
    headers,
  })
}

async function proxy(request, upstreamOrigin, caddyBlock = '') {
  const requestUrl = new URL(request.url)
  const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, upstreamOrigin)
  const headers = new Headers(request.headers)
  headers.delete('connection')
  headers.delete('host')

  try {
    const response = await fetch(upstreamUrl, {
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      headers,
      method: request.method,
      redirect: 'manual',
    })
    const responseHeaders = new Headers(response.headers)
    // fetch() decodes compressed upstream bodies before exposing the stream.
    // Do not forward the stale encoding/length metadata to the browser.
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')
    responseHeaders.delete('transfer-encoding')
    applyCaddyHeaders(responseHeaders, caddyBlock)
    return new Response(response.body, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    })
  } catch (error) {
    console.error('Split-domain edge upstream failure', {
      message: error instanceof Error ? error.message : 'unknown error',
      upstream: upstreamOrigin,
    })
    return new Response('Isolated edge upstream unavailable', { status: 502 })
  }
}

function applyCaddyHeaders(headers, block) {
  if (!block) return

  for (const name of [
    'Strict-Transport-Security',
    'Content-Security-Policy',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'X-Frame-Options',
    'X-Robots-Tag',
  ]) {
    const value = block.match(new RegExp(`(?:^|\\n)\\s*${name} "([^"]+)"`))?.[1]
    if (value) headers.set(name, localizeCsp(value))
  }
  if (block.includes('-Server')) headers.delete('server')
}

function localizeCsp(value) {
  const apiWebSocketOrigin = apiOrigin.replace(/^http/, 'ws')
  return value
    .replaceAll('wss://api.anomaly-detector.ru', apiWebSocketOrigin)
    .replaceAll('https://api.anomaly-detector.ru', apiOrigin)
}
