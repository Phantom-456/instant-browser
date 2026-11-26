/**
 * Signing in to Google for Drive sync (Alpha 04): the pure parts. The program opens Google's page in your normal
 * browser (never inside the app), Google sends a one-time code back to a small local address, and the program trades it for
 * tokens. PKCE (RFC 7636) makes the code useless to anyone who sees it but does not have the secret verifier.
 *
 * The only permission asked for is the app data folder: one hidden folder of your Drive that only this app can see.
 */

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

export interface OAuthEndpoints {
  auth: string
  token: string
  revoke: string
  /** Drive API (metadata, download). */
  drive: string
  /** Drive API (upload). */
  upload: string
}

export const GOOGLE_ENDPOINTS: OAuthEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  drive: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3'
}

/** Base64 without padding and with - and _ (safe in an address). */
export function base64url(bytes: Uint8Array): string {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The PKCE challenge for a verifier: base64url of its SHA-256. The caller passes the hash function (Node's crypto). */
export function challengeFor(verifier: string, sha256: (text: string) => Uint8Array): string {
  return base64url(sha256(verifier))
}

export function buildAuthUrl(opts: { endpoints: OAuthEndpoints; clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(opts.endpoints.auth)
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPE)
  url.searchParams.set('state', opts.state)
  url.searchParams.set('code_challenge', opts.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline') // so Google gives a refresh token and you do not have to sign in again
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

export type RedirectResult = { ok: true; code: string } | { ok: false; reason: 'denied' | 'state' | 'missing' }

/** What came back on the local address. A wrong state means the request did not come from our own sign-in: refused. */
export function parseRedirect(requestUrl: string, expectedState: string): RedirectResult {
  let url: URL
  try { url = new URL(requestUrl, 'http://127.0.0.1') } catch { return { ok: false, reason: 'missing' } }
  if (url.searchParams.get('error')) return { ok: false, reason: 'denied' }
  if (url.searchParams.get('state') !== expectedState) return { ok: false, reason: 'state' }
  const code = url.searchParams.get('code')
  return code ? { ok: true, code } : { ok: false, reason: 'missing' }
}

export interface Tokens {
  accessToken: string
  /** Kept to get new access tokens without asking you again. */
  refreshToken: string | null
  /** When the access token stops working (milliseconds). */
  expiresAt: number
}

/** A token answer from Google. A refresh answer has no new refresh token: the old one is kept. */
export function tokensFromResponse(json: unknown, now: number, previous: Tokens | null = null): Tokens | null {
  const r = json as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null
  if (!r || typeof r.access_token !== 'string' || !r.access_token) return null
  const seconds = typeof r.expires_in === 'number' && r.expires_in > 0 ? r.expires_in : 3600
  const refresh = typeof r.refresh_token === 'string' && r.refresh_token ? r.refresh_token : previous?.refreshToken ?? null
  return { accessToken: r.access_token, refreshToken: refresh, expiresAt: now + seconds * 1000 }
}

/** Is it time for a new access token? (One minute early, so a request never starts with a token that is about to end.) */
export const needsRefresh = (tokens: Tokens, now: number, skewMs = 60_000): boolean => now >= tokens.expiresAt - skewMs

/** Only accept tokens that were saved by this program in the shape we know. */
export function parseSavedTokens(raw: unknown): Tokens | null {
  const r = raw as Partial<Tokens> | null
  if (!r || typeof r.accessToken !== 'string' || typeof r.expiresAt !== 'number') return null
  return { accessToken: r.accessToken, refreshToken: typeof r.refreshToken === 'string' ? r.refreshToken : null, expiresAt: r.expiresAt }
}
