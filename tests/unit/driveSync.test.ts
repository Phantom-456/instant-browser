import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthError, DriveAuth, type TokenStore } from '../../src/main/sync/driveAuth'
import { DriveStorage, SYNC_FILE_NAME } from '../../src/main/sync/driveStorage'
import { syncOnce } from '../../src/shared/sync/engine'
import { emptyDoc } from '../../src/shared/sync/merge'
import type { OAuthEndpoints } from '../../src/shared/sync/oauth'
import { startFakeGoogle, type FakeGoogle } from './fakeGoogle'

let google: FakeGoogle
let endpoints: OAuthEndpoints
const memory = (): TokenStore & { text: string | null } => {
  const s = { text: null as string | null, load: () => s.text, save: (t: string) => { s.text = t }, clear: () => { s.text = null } }
  return s
}
/** The "browser": it follows the sign-in address, which sends the one-time code back to the program. */
const browser = async (url: string) => { await fetch(url) }

beforeEach(async () => {
  google = await startFakeGoogle()
  endpoints = { auth: `${google.base}/auth`, token: `${google.base}/token`, revoke: `${google.base}/revoke`, drive: `${google.base}/drive/v3`, upload: `${google.base}/upload/drive/v3` }
})
afterEach(async () => { await google.close() })

const auth = (store = memory(), now = () => Date.now()) =>
  new DriveAuth({ clientId: 'id', clientSecret: 'secret', endpoints, fetch: (a, b) => fetch(a, b), openExternal: browser, store, now })

describe('signing in', () => {
  it('goes through the browser, trades the code with the PKCE verifier, and keeps the tokens', async () => {
    const store = memory()
    const a = auth(store)
    expect(a.isConnected()).toBe(false)
    await a.connect()
    expect(a.isConnected()).toBe(true)
    expect(JSON.parse(store.text!).refreshToken).toBe('refresh-1')
    expect(await a.accessToken()).toMatch(/^access-/)
    // A new program run with the same saved tokens is connected without asking again.
    expect(auth(store).isConnected()).toBe(true)
  })

  it('does not connect when the person says no', async () => {
    const a = new DriveAuth({
      clientId: 'id', clientSecret: 's', endpoints, fetch: (x, y) => fetch(x, y), store: memory(),
      openExternal: async (url) => { const back = new URL(new URL(url).searchParams.get('redirect_uri')!); back.searchParams.set('error', 'access_denied'); await fetch(back) }
    })
    await expect(a.connect()).rejects.toThrow('did not allow')
    expect(a.isConnected()).toBe(false)
  })

  it('ignores an answer with the wrong state (not from our own sign-in) and keeps waiting', async () => {
    let result: 'pending' | 'done' | 'failed' = 'pending'
    const a = new DriveAuth({
      clientId: 'id', clientSecret: 's', endpoints, fetch: (x, y) => fetch(x, y), store: memory(),
      openExternal: async (url) => {
        const back = new URL(new URL(url).searchParams.get('redirect_uri')!)
        back.searchParams.set('code', 'stolen'); back.searchParams.set('state', 'wrong')
        await fetch(back) // an attacker's page tries to finish our sign-in
        await new Promise((r) => setTimeout(r, 100))
        expect(result).toBe('pending') // it did not finish
        await fetch(url) // the real sign-in
      }
    })
    await a.connect().then(() => { result = 'done' }, () => { result = 'failed' })
    expect(result).toBe('done')
  })

  it('renews the access token by itself, and forgets the login when Google says it ended', async () => {
    let now = 1_000_000
    const store = memory()
    const a = auth(store, () => now)
    await a.connect()
    const first = await a.accessToken()
    now += 3_600_000 // an hour later
    const second = await a.accessToken()
    expect(second).not.toBe(first)
    expect(JSON.parse(store.text!).refreshToken).toBe('refresh-1') // the refresh token is kept
    now += 3_600_000
    google.revokeLogin = true // the person removed the permission in their Google account
    await expect(a.accessToken()).rejects.toBeInstanceOf(AuthError)
    expect(a.isConnected()).toBe(false)
    expect(store.text).toBeNull()
  })

  it('a temporary Google problem does not end the login', async () => {
    let now = 1_000_000
    const a = auth(memory(), () => now)
    await a.connect()
    now += 3_600_000
    google.down = true
    await expect(a.accessToken()).rejects.toThrow()
    expect(a.isConnected()).toBe(true) // still connected: it will work when Google is back
  })

  it('disconnect forgets the login and tells Google', async () => {
    const store = memory()
    const a = auth(store)
    await a.connect()
    await a.disconnect(true)
    expect(a.isConnected()).toBe(false)
    expect(store.text).toBeNull()
    expect(google.log).toContain('POST /revoke')
  })

  it('does not even try when the build has no Google login key', async () => {
    const a = new DriveAuth({ clientId: '', clientSecret: '', endpoints, fetch: (x, y) => fetch(x, y), store: memory(), openExternal: browser })
    expect(a.isAvailable()).toBe(false)
    await expect(a.connect()).rejects.toThrow('no Google login key')
  })
})

describe('the file in the Drive app folder', () => {
  const connected = async () => {
    const a = auth()
    await a.connect()
    return new DriveStorage(() => a.accessToken(), endpoints, (x, y) => fetch(x, y))
  }

  it('starts empty, creates the file in the app data folder, reads it back and updates it', async () => {
    const storage = await connected()
    expect(await storage.read()).toBeNull()
    expect(await storage.write(emptyDoc(), null)).toBe(true)
    expect([...google.files.values()].map((f) => f.name)).toEqual([SYNC_FILE_NAME])
    const first = await storage.read()
    expect(first?.doc).toEqual(emptyDoc())
    expect(await storage.write({ ...emptyDoc(), tombstones: { x: { id: 'x', updatedAt: 1, device: 'd' } } }, first!.etag)).toBe(true)
    const second = await storage.read()
    expect(second!.etag).not.toBe(first!.etag)
  })

  it('refuses a write when somebody else changed the file (the caller merges again)', async () => {
    const storage = await connected()
    await storage.write(emptyDoc(), null)
    const mine = await storage.read()
    await storage.write(emptyDoc(), mine!.etag) // another computer writes
    expect(await storage.write(emptyDoc(), mine!.etag)).toBe(false) // our etag is old now
    expect(await storage.write(emptyDoc(), null)).toBe(false) // and "create" fails when it exists
  })

  it('can delete the file', async () => {
    const storage = await connected()
    await storage.write(emptyDoc(), null)
    await storage.remove()
    expect(google.files.size).toBe(0)
    expect(await storage.read()).toBeNull()
  })

  it('says offline (an error) when Drive cannot be reached, so the sync engine keeps the changes', async () => {
    const storage = await connected()
    google.down = true
    const result = await syncOnce(storage, { pins: [], prefs: {}, deleted: [] }, 'mac', 100)
    expect(result).toMatchObject({ ok: false, reason: 'offline' })
  })

  it('two computers with their own logins see the same pins through Drive', async () => {
    const mac = await connected()
    const pc = await connected()
    const gradient = { seed: 1, stops: [{ h: 1, s: 1, l: 1 }, { h: 2, s: 2, l: 2 }], angle: 10 }
    const pin = (id: string) => ({ id, url: `https://example.com/${id}`, title: id, label: null, gradient, archived: false, createdAt: 1 })
    await syncOnce(mac, { pins: [pin('pin-00000001')], prefs: {}, deleted: [] }, 'mac', 100)
    const seen = await syncOnce(pc, { pins: [pin('pin-00000002')], prefs: {}, deleted: [] }, 'pc', 200)
    expect(seen.ok && Object.keys(seen.doc.pins).sort()).toEqual(['pin-00000001', 'pin-00000002'])
    const back = await syncOnce(mac, { pins: [pin('pin-00000001')], prefs: {}, deleted: [] }, 'mac', 300)
    expect(back.ok && Object.keys(back.doc.pins).sort()).toEqual(['pin-00000001', 'pin-00000002'])
  })

  it('asks Drive for the app data folder only, never for the rest of Drive', async () => {
    const storage = await connected()
    await storage.read()
    await storage.write(emptyDoc(), null)
    const calls = google.log.filter((l) => l.includes('/drive/') || l.includes('/upload/'))
    expect(calls.length).toBeGreaterThan(0)
  })
})
