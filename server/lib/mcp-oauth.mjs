// OAuth 2.1 for remote MCP servers: protected-resource + authorization-server discovery,
// dynamic client registration (RFC 7591), PKCE (S256) and token refresh. Zero dependencies.
// Tokens never reach the browser; the daemon keeps them in the encrypted secrets file.
import { createHash, randomBytes } from 'node:crypto'

const FETCH_TIMEOUT_MS = 15_000
const PENDING_TTL_MS = 10 * 60_000

export class AuthRequiredError extends Error {
  constructor(wwwAuthenticate = '') {
    super('This MCP server needs you to sign in.')
    this.name = 'AuthRequiredError'
    this.wwwAuthenticate = wwwAuthenticate
  }
}

const b64url = (buffer) => buffer.toString('base64url')

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { response, body, text }
}

function assertHttp(value, label) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid URL.`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label} must use http or https.`)
  return parsed
}

/** Reads `resource_metadata="…"` from a WWW-Authenticate header. */
export function parseResourceMetadataUrl(header) {
  const match = /resource_metadata="?([^",\s]+)"?/i.exec(header ?? '')
  return match ? match[1] : ''
}

function wellKnownCandidates(base, name) {
  const parsed = new URL(base)
  const out = []
  const pathPart = parsed.pathname.replace(/\/+$/, '')
  if (pathPart) out.push(`${parsed.origin}/.well-known/${name}${pathPart}`)
  out.push(`${parsed.origin}/.well-known/${name}`)
  return out
}

async function firstJson(urls, accept = (body) => body && typeof body === 'object') {
  for (const url of urls) {
    try {
      const { response, body } = await fetchJson(url)
      if (response.ok && accept(body)) return body
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

/** Finds the authorization server metadata that protects an MCP server URL. */
export async function discover(serverUrl, wwwAuthenticate = '') {
  assertHttp(serverUrl, 'The MCP server URL')
  const hinted = parseResourceMetadataUrl(wwwAuthenticate)
  const resourceUrls = [...(hinted ? [hinted] : []), ...wellKnownCandidates(serverUrl, 'oauth-protected-resource')]
  const resource = await firstJson(resourceUrls, (body) => body && Array.isArray(body.authorization_servers))
  const issuer = resource?.authorization_servers?.[0] || new URL(serverUrl).origin
  assertHttp(issuer, 'The authorization server')
  const metadata =
    (await firstJson(
      [
        ...wellKnownCandidates(issuer, 'oauth-authorization-server'),
        ...wellKnownCandidates(issuer, 'openid-configuration'),
        `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
      ],
      (body) => body && typeof body.authorization_endpoint === 'string' && typeof body.token_endpoint === 'string',
    )) ?? null
  if (metadata) return { ...metadata, resource: resource?.resource || serverUrl }
  // Servers without metadata fall back to the conventional endpoints on the issuer origin.
  const origin = new URL(issuer).origin
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    resource: resource?.resource || serverUrl,
    fallback: true,
  }
}

export async function registerClient(metadata, redirectUri, clientName) {
  if (!metadata.registration_endpoint) {
    throw new Error('This server does not support automatic sign-in setup. Enter an OAuth client ID in the server settings.')
  }
  const { response, body, text } = await fetchJson(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (!response.ok || !body?.client_id) {
    throw new Error(`Client registration failed (${response.status}). ${(body?.error_description || text || '').slice(0, 200)}`.trim())
  }
  return { clientId: String(body.client_id), clientSecret: body.client_secret ? String(body.client_secret) : '' }
}

export function createPkce() {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function buildAuthorizationUrl({ metadata, clientId, redirectUri, state, challenge, scope, resource }) {
  const url = new URL(metadata.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (scope) url.searchParams.set('scope', scope)
  if (resource) url.searchParams.set('resource', resource)
  return url.toString()
}

async function tokenRequest(metadata, client, params, resource) {
  const form = new URLSearchParams({ ...params, client_id: client.clientId })
  if (resource) form.set('resource', resource)
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (client.clientSecret) {
    const methods = metadata.token_endpoint_auth_methods_supported
    if (Array.isArray(methods) && !methods.includes('client_secret_post') && methods.includes('client_secret_basic')) {
      headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`
    } else {
      form.set('client_secret', client.clientSecret)
    }
  }
  const { response, body, text } = await fetchJson(metadata.token_endpoint, { method: 'POST', headers, body: form.toString() })
  if (!response.ok || !body?.access_token) {
    const detail = body?.error_description || body?.error || text || ''
    const error = new Error(`Token request failed (${response.status}). ${String(detail).slice(0, 200)}`.trim())
    error.status = response.status
    error.oauthError = body?.error
    throw error
  }
  return normalizeTokens(body)
}

function normalizeTokens(body, previous) {
  const expiresIn = Number(body.expires_in)
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : previous?.refreshToken || '',
    tokenType: body.token_type ? String(body.token_type) : 'Bearer',
    scope: typeof body.scope === 'string' ? body.scope : previous?.scope || '',
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
  }
}

export function exchangeCode({ metadata, client, code, verifier, redirectUri, resource }) {
  return tokenRequest(metadata, client, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  }, resource)
}

export async function refreshTokens({ metadata, client, tokens, resource }) {
  if (!tokens?.refreshToken) throw new Error('No refresh token; sign in again.')
  const next = await tokenRequest(metadata, client, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, resource)
  return { ...next, refreshToken: next.refreshToken || tokens.refreshToken }
}

export const tokenIsFresh = (tokens, skewMs = 60_000) =>
  Boolean(tokens?.accessToken) && (!tokens.expiresAt || tokens.expiresAt - skewMs > Date.now())

/** In-flight authorization requests keyed by the OAuth `state` value. */
export class PendingAuthorizations {
  constructor() {
    this.map = new Map()
  }

  create(entry) {
    this.#purge()
    const state = b64url(randomBytes(24))
    this.map.set(state, { ...entry, createdAt: Date.now() })
    return state
  }

  take(state) {
    this.#purge()
    const entry = this.map.get(state)
    if (entry) this.map.delete(state)
    return entry ?? null
  }

  #purge() {
    const cutoff = Date.now() - PENDING_TTL_MS
    for (const [key, value] of this.map) if (value.createdAt < cutoff) this.map.delete(key)
  }
}
