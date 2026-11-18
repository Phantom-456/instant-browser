import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import {
  base64url, buildAuthUrl, challengeFor, needsRefresh, parseRedirect, parseSavedTokens, tokensFromResponse, type OAuthEndpoints, type Tokens
} from '../../shared/sync/oauth'

/** Where the tokens are kept. In the app they are encrypted with the system keychain; tests use memory. */
export interface TokenStore {
  load(): string | null
  save(text: string): void
  clear(): void
}

export class AuthError extends Error {}

export interface DriveAuthDeps {
  clientId: string
  clientSecret: string
  endpoints: OAuthEndpoints
  fetch: typeof fetch
  /** Open an address in the person's normal browser. */
  openExternal: (url: string) => Promise<void> | void
  store: TokenStore
  now?: () => number
  /** How long to wait for the person to finish signing in. */
  timeoutMs?: number
}

const DONE_PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px -apple-system,system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222"><h1 style="font-size:1.4rem">${title}</h1><p>${body}</p>`

/**
 * Google sign-in for a desktop app: the system browser, a one-time return on 127.0.0.1, PKCE. The tokens are kept
 * encrypted; the access token is renewed by itself. Nothing here sees your Google password.
 */
export class DriveAuth {
  private tokens: Tokens | null
  private server: Server | null = null

  constructor(private readonly deps: DriveAuthDeps) {
    const raw = deps.store.load()
    let parsed: Tokens | null = null
    try { parsed = raw ? parseSavedTokens(JSON.parse(raw)) : null } catch { parsed = null }
    this.tokens = parsed
  }

  private now = () => (this.deps.now ?? Date.now)()
  /** Is this build able to sign in at all (does it have the Google client)? */
  isAvailable(): boolean { return !!this.deps.clientId && !!this.deps.clientSecret }
  isConnected(): boolean { return !!this.tokens?.refreshToken }

  /** Open Google, wait for the person to say yes, and keep the tokens. Throws if they say no or do not answer. */
  async connect(): Promise<void> {
    if (!this.isAvailable()) throw new AuthError('This build has no Google login key.')
    this.stopServer()
    const verifier = base64url(randomBytes(32))
    const state = base64url(randomBytes(16))
    const challenge = challengeFor(verifier, (t) => new Uint8Array(createHash('sha256').update(t).digest()))
    const { code, redirectUri } = await this.waitForCode(state, challenge)
    const response = await this.deps.fetch(this.deps.endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.deps.clientId, client_secret: this.deps.clientSecret, code, code_verifier: verifier,
        redirect_uri: redirectUri, grant_type: 'authorization_code'
      })
    })
    const tokens = tokensFromResponse(await response.json().catch(() => null), this.now())
    if (!response.ok || !tokens || !tokens.refreshToken) throw new AuthError('Google did not give a login. Try again.')
    this.keep(tokens)
  }

  private waitForCode(state: string, challenge: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const result = parseRedirect(req.url ?? '/', state)
        if (!req.url || req.url === '/favicon.ico') { res.writeHead(404).end(); return }
        if (result.ok) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE('Connected', 'You can close this tab and go back to the app.'))
          finish(() => resolve({ code: result.code, redirectUri }))
        } else {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE('Not connected', 'The sign-in was not finished. You can close this tab and try again in the app.'))
          if (result.reason !== 'state') finish(() => reject(new AuthError(result.reason === 'denied' ? 'You did not allow the connection.' : 'Google sent no code.')))
        }
      })
      this.server = server
      let redirectUri = ''
      let done = false
      const timer = setTimeout(() => finish(() => reject(new AuthError('The sign-in took too long. Try again.'))), this.deps.timeoutMs ?? 300_000)
      const finish = (then: () => void) => {
        if (done) return
        done = true
        clearTimeout(timer)
        this.stopServer()
        then()
      }
      server.on('error', (e) => finish(() => reject(e)))
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port
        redirectUri = `http://127.0.0.1:${port}`
        void Promise.resolve(this.deps.openExternal(buildAuthUrl({ endpoints: this.deps.endpoints, clientId: this.deps.clientId, redirectUri, state, challenge })))
          .catch((e) => finish(() => reject(e)))
      })
    })
  }

  private stopServer(): void {
    this.server?.close()
    this.server?.closeAllConnections?.()
    this.server = null
  }

  private keep(tokens: Tokens): void {
    this.tokens = tokens
    this.deps.store.save(JSON.stringify(tokens))
  }

  /** A working access token. It is renewed first if it is about to end. Throws AuthError when the login no longer works. */
  async accessToken(): Promise<string> {
    const current = this.tokens
    if (!current?.refreshToken) throw new AuthError('Not connected.')
    if (!needsRefresh(current, this.now())) return current.accessToken
    const response = await this.deps.fetch(this.deps.endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.deps.clientId, client_secret: this.deps.clientSecret, refresh_token: current.refreshToken, grant_type: 'refresh_token' })
    })
    const json = await response.json().catch(() => null)
    const next = tokensFromResponse(json, this.now(), current)
    if (!response.ok || !next) {
      // Google says the login is no longer valid (the person removed it, or it expired): forget it, ask again.
      if ((json as { error?: string } | null)?.error === 'invalid_grant') { this.forget(); throw new AuthError('The Google login ended. Connect again.') }
      throw new Error(`Google answered ${response.status}`) // a temporary problem: the login stays
    }
    this.keep(next)
    return next.accessToken
  }

  private forget(): void {
    this.tokens = null
    this.deps.store.clear()
  }

  /** Forget the login here. With `revoke`, also tell Google to end it. */
  async disconnect(revoke: boolean): Promise<void> {
    const token = this.tokens?.refreshToken ?? this.tokens?.accessToken
    this.stopServer()
    this.forget()
    if (revoke && token) {
      try { await this.deps.fetch(this.deps.endpoints.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }) } catch { /* best effort */ }
    }
  }
}
