/**
 * OAuth password-grant token minting for Aras 12+.
 *
 * The production tool does NOT use this — the browser extension forwards the session's
 * existing bearer token. This helper is for tests and CLI/manual use (mint a token from
 * a username/password) and mirrors what Aras's own IOM PasswordTokenProvider does:
 * Aras requires the password as a lowercase-hex MD5 hash (a raw password is rejected with
 * `incompatible_hash_use_md5`).
 */
import { createHash } from 'node:crypto'

/** Lowercase-hex MD5 of the password, as Aras's token endpoint expects. */
export function md5Password(password: string): string {
  return createHash('md5').update(password, 'utf8').digest('hex')
}

/** Derive the token endpoint from an instance base URL, e.g. http://host/db -> .../OAuthServer/connect/token */
export function tokenEndpoint(instanceUrl: string): string {
  return instanceUrl.replace(/\/+$/, '') + '/OAuthServer/connect/token'
}

export interface MintOptions {
  url: string
  database: string
  username: string
  password: string
  clientId?: string
  scope?: string
}

/** Build the x-www-form-urlencoded body for the password grant (pure; hashes the password). */
export function buildTokenForm(opts: MintOptions): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'password',
    client_id: opts.clientId ?? 'IOMApp',
    scope: opts.scope ?? 'Innovator openid',
    username: opts.username,
    password: md5Password(opts.password),
    database: opts.database
  })
}

export interface MintedToken {
  accessToken: string
  tokenType: string
  expiresIn: number
}

/** Mint a bearer token via the OAuth password grant. Network call — used by tests/CLI. */
export async function mintToken(opts: MintOptions): Promise<MintedToken> {
  const res = await fetch(tokenEndpoint(opts.url), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: buildTokenForm(opts).toString()
  })
  const text = await res.text()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`token endpoint returned non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new Error(`token mint failed (${res.status}): ${json.error ?? text.slice(0, 200)}`)
  }
  return {
    accessToken: json.access_token,
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 0
  }
}
