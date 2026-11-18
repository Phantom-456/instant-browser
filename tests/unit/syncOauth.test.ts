import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateGradient } from '../../src/shared/pins/gradient'
import { createPin } from '../../src/shared/pins/model'
import { planApply } from '../../src/shared/sync/apply'
import { applyLocal, emptyDoc } from '../../src/shared/sync/merge'
import {
  GOOGLE_ENDPOINTS, GOOGLE_SCOPE, base64url, buildAuthUrl, challengeFor, needsRefresh, parseRedirect, parseSavedTokens, tokensFromResponse
} from '../../src/shared/sync/oauth'
import { toSyncPin } from '../../src/shared/sync/portable'

const sha = (text: string) => new Uint8Array(createHash('sha256').update(text).digest())

describe('signing in to Google', () => {
  it('makes the PKCE challenge the way RFC 7636 says (its own test values)', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', sha)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('base64url has no +, / or = characters', () => {
    expect(base64url(new Uint8Array([251, 255, 254, 62, 63]))).toBe('-__-Pj8')
  })

  it('asks for the app data folder only, with PKCE and a refresh token', () => {
    const url = new URL(buildAuthUrl({ endpoints: GOOGLE_ENDPOINTS, clientId: 'id.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:5555', state: 'abc', challenge: 'xyz' }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata')
    expect(GOOGLE_SCOPE).toBe('https://www.googleapis.com/auth/drive.appdata')
    expect(url.searchParams.get('code_challenge')).toBe('xyz')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555')
  })

  it('accepts the answer only when the state is ours', () => {
    expect(parseRedirect('/?code=C1&state=S', 'S')).toEqual({ ok: true, code: 'C1' })
    expect(parseRedirect('/?code=C1&state=OTHER', 'S')).toEqual({ ok: false, reason: 'state' })
    expect(parseRedirect('/?error=access_denied&state=S', 'S')).toEqual({ ok: false, reason: 'denied' })
    expect(parseRedirect('/?state=S', 'S')).toEqual({ ok: false, reason: 'missing' })
    expect(parseRedirect('/', 'S')).toEqual({ ok: false, reason: 'state' })
  })

  it('reads token answers, and keeps the old refresh token when a refresh does not send a new one', () => {
    const first = tokensFromResponse({ access_token: 'A1', refresh_token: 'R1', expires_in: 3600 }, 1000)!
    expect(first).toEqual({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 1000 + 3_600_000 })
    const next = tokensFromResponse({ access_token: 'A2', expires_in: 1800 }, 5000, first)!
    expect(next).toEqual({ accessToken: 'A2', refreshToken: 'R1', expiresAt: 5000 + 1_800_000 })
    expect(tokensFromResponse({ error: 'invalid_grant' }, 0)).toBeNull()
    expect(tokensFromResponse(null, 0)).toBeNull()
  })

  it('refreshes a minute before the token ends', () => {
    const t = { accessToken: 'A', refreshToken: 'R', expiresAt: 100_000 }
    expect(needsRefresh(t, 39_999)).toBe(false)
    expect(needsRefresh(t, 40_000)).toBe(true)
  })

  it('only takes saved tokens in the shape it saved them', () => {
    expect(parseSavedTokens({ accessToken: 'A', refreshToken: 'R', expiresAt: 5 })).toEqual({ accessToken: 'A', refreshToken: 'R', expiresAt: 5 })
    expect(parseSavedTokens({ accessToken: 1 })).toBeNull()
    expect(parseSavedTokens(null)).toBeNull()
  })
})

describe('what to change here after a sync', () => {
  const pin = (id: string, over = {}) => ({ ...createPin({ url: `https://example.com/${id}`, title: id, window: { x: 1, y: 1, width: 400, height: 500 }, pin: { x: 5, y: 5 }, following: false, gradient: generateGradient([], 1) }, id, 1000), ...over })
  const docFrom = (device: string, t: number, ...pins: ReturnType<typeof pin>[]) => applyLocal(emptyDoc(), { pins: pins.map(toSyncPin), prefs: {}, deleted: [] }, device, t)

  it('adds a pin that came from another computer', () => {
    const plan = planApply(docFrom('pc', 100, pin('pin-00000001')), [], 'mac')
    expect(plan.add.map((p) => p.id)).toEqual(['pin-00000001'])
    expect(plan.update).toEqual([])
  })

  it('updates a pin that another computer renamed, but not one this computer changed itself', () => {
    const local = pin('pin-00000001')
    const renamed = docFrom('pc', 200, { ...local, label: 'Renamed' })
    expect(planApply(renamed, [local], 'mac').update.map((p) => p.label)).toEqual(['Renamed'])
    expect(planApply(renamed, [local], 'pc').update).toEqual([]) // pc made that change itself
  })

  it('does nothing when nothing differs', () => {
    const local = pin('pin-00000001')
    const plan = planApply(docFrom('pc', 100, local), [local], 'mac')
    expect([plan.add, plan.update, plan.remove]).toEqual([[], [], []])
    expect(plan.bookmarks).toEqual({ add: [], update: [], remove: [] })
  })

  it('removes a pin that was deleted for good on another computer', () => {
    const local = pin('pin-00000001')
    const base = docFrom('mac', 100, local)
    const deleted = applyLocal(base, { pins: [], prefs: {}, deleted: ['pin-00000001'] }, 'pc', 500)
    expect(planApply(deleted, [local], 'mac').remove).toEqual(['pin-00000001'])
  })
})
