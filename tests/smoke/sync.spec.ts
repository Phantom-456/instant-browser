import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeGoogle, type FakeGoogle } from '../unit/fakeGoogle'

let site: Server
let base: string
let google: FakeGoogle
const apps: ElectronApplication[] = []

test.beforeAll(async () => {
  site = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Synced page</title><h1>synced</h1>') })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
  google = await startFakeGoogle()
})
test.afterAll(async () => {
  for (const a of apps) await a.close().catch(() => {})
  await google.close()
  site.close()
})

type Pins = { pins(): Array<{ id: string; state: string; url: string; archived: boolean }>; liveIds(): string[]; managerAction(a: { type: string; id: string }): Promise<void> }
type Sync = { connect(): Promise<void>; syncNow(): Promise<void>; setPassphrase(p: string): Promise<void>; unlock(p: string): Promise<void>; status(): { state: string; message: string; available: boolean; lastSyncAt: number | null } }
const launch = async (args: string[]) => {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-sync-'))}`, ...args],
    env: { ...process.env, INSTANT_TEST_PINS: '1', INSTANT_TEST_NO_POLL: '1', INSTANT_TEST_GOOGLE_BASE: google.base, INSTANT_TEST_GOOGLE_ID: 'id', INSTANT_TEST_GOOGLE_SECRET: 'secret' }
  })
  apps.push(app)
  await expect.poll(() => app.evaluate(() => !!(globalThis as Record<string, unknown>).__sync), { timeout: 15_000 }).toBe(true)
  return app
}
const pins = (a: ElectronApplication) => a.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.pins())
const status = (a: ElectronApplication) => a.evaluate(() => (globalThis as unknown as { __sync: Sync }).__sync.status())
const call = (a: ElectronApplication, what: 'connect' | 'syncNow') => a.evaluate((_e, w) => (globalThis as unknown as { __sync: Sync }).__sync[w](), what)
const withPassphrase = (a: ElectronApplication, what: 'setPassphrase' | 'unlock', passphrase: string) => a.evaluate((_e, x) => (globalThis as unknown as { __sync: Sync }).__sync[x.what](x.passphrase), { what, passphrase })
const PASSPHRASE = 'my long secret passphrase'

test('two computers: connect to Drive, pins travel, and a pin deleted for good on one goes from the other', async () => {
  // Computer A has a window with a page. It becomes a pin.
  const a = await launch([`${base}/`])
  await expect.poll(() => a.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'Synced page'))).toBe(true)
  await new Promise((r) => setTimeout(r, 600))
  await a.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  })
  await expect.poll(async () => (await pins(a)).length, { timeout: 10_000 }).toBe(1)
  await new Promise((r) => setTimeout(r, 900))

  expect((await status(a)).state).toBe('off')
  await call(a, 'connect') // opens "the browser" (the fake Google says yes) and trades the code
  await expect.poll(async () => (await status(a)).state, { timeout: 15_000 }).toBe('needs-passphrase')
  expect(google.files.size).toBe(0) // nothing is sent before the passphrase is chosen
  await withPassphrase(a, 'setPassphrase', 'short') // too short: refused
  expect((await status(a)).state).toBe('needs-passphrase')
  await withPassphrase(a, 'setPassphrase', PASSPHRASE)
  await expect.poll(async () => (await status(a)).state, { timeout: 15_000 }).toBe('idle')
  expect((await status(a)).message).toMatch(/^Connected/)
  const shown = (await status(a)) as unknown as { security: { active: boolean; cipher: string; keySetAt: number | null; rating: string } | null; counts: { pins: { synced: number; local: number } } }
  expect(shown.security).toMatchObject({ active: true, cipher: 'AES-256-GCM' }) // the Settings screen can show that the lock is on
  expect(shown.security!.keySetAt).not.toBeNull()
  expect(shown.security!.rating).not.toBe('')

  // Drive now holds one file in the app data folder, and it is scrambled: no address, no title, nothing readable.
  expect(google.files.size).toBe(1)
  const body = [...google.files.values()][0]!.body
  expect(JSON.parse(body)).toMatchObject({ v: 1, kdf: { name: 'scrypt' } })
  expect(body).not.toContain(base)
  expect(body).not.toContain('Synced page')
  expect(body).not.toContain('example')

  // Computer B (another user data folder) connects and gets the pin, released, not as an open window.
  const b = await launch([])
  expect(await pins(b)).toEqual([])
  await call(b, 'connect')
  await expect.poll(async () => (await status(b)).state, { timeout: 15_000 }).toBe('locked') // the file is locked and B has no key
  expect(await pins(b)).toEqual([])
  await withPassphrase(b, 'unlock', 'a wrong passphrase')
  expect((await status(b)).state).toBe('locked')
  expect(await pins(b)).toEqual([])
  await withPassphrase(b, 'unlock', PASSPHRASE)
  await expect.poll(async () => (await pins(b)).length, { timeout: 15_000 }).toBe(1)
  const [pinB] = await pins(b)
  expect(pinB).toMatchObject({ url: `${base}/`, state: 'offloaded', archived: false })
  expect(await b.evaluate(({ BaseWindow, BrowserWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible() && !(w instanceof BrowserWindow) && w.contentView.children.some((v) => 'webContents' in v)).length)).toBe(0) // no window opened

  // On A the pin is removed and deleted for good. After a sync on both, B loses it too.
  const [pinA] = await pins(a)
  await a.evaluate(async (_e, id) => {
    const m = (globalThis as unknown as { __pins: Pins }).__pins
    await m.managerAction({ type: 'archive', id })
    await m.managerAction({ type: 'delete', id })
  }, pinA!.id)
  expect(await pins(a)).toEqual([])
  await call(a, 'syncNow')
  await call(b, 'syncNow')
  await expect.poll(async () => (await pins(b)).length, { timeout: 15_000 }).toBe(0)
})

test('without the network the app keeps working and says so; with Drive back it syncs again', async () => {
  const a = await launch([])
  await call(a, 'connect')
  // The file from the first test is still in the pretend Drive, locked: this computer unlocks it.
  await expect.poll(async () => (await status(a)).state, { timeout: 15_000 }).toBe('locked')
  await withPassphrase(a, 'unlock', PASSPHRASE)
  await expect.poll(async () => (await status(a)).state, { timeout: 15_000 }).toBe('idle')
  google.down = true
  await call(a, 'syncNow')
  expect((await status(a)).state).toBe('offline')
  google.down = false
  await call(a, 'syncNow')
  expect((await status(a)).state).toBe('idle')
})

test('the Settings screen has a Sync section that says what is and is not synced', async () => {
  const a = await launch([])
  // Open Settings on the Sync section through the search bar's own channel (asking again until its page is ready) and read the page.
  await expect.poll(() => a.evaluate(async ({ webContents }) => {
    const settingsPage = () => webContents.getAllWebContents().find((w) => w.getURL().includes('/settings/'))
    if (!settingsPage()) {
      const bar = webContents.getAllWebContents().find((w) => w.getURL().includes('/search/'))
      await bar?.executeJavaScript("window.instantSearch?.openSettings('Sync')").catch(() => {})
    }
    const wc = settingsPage()
    return wc ? ((await wc.executeJavaScript('document.body.innerText').catch(() => '')) as string) : ''
  }), { timeout: 15_000, intervals: [300] }).toContain('What is never synced')
  const text = await a.evaluate(async ({ webContents }) => (await webContents.getAllWebContents().find((w) => w.getURL().includes('/settings/'))?.executeJavaScript('document.body.innerText')) as string)
  expect(text).toContain('Connect Google Drive')
  expect(text).toMatch(/Passwords, cookies/)
})

// ---- Bookmarks, history and open pages (each with its own switch), Sync now, and the last sync when the app quits ----

type Bm = { list(): Array<{ url: string; title: string }>; has(url: string): boolean }
type Hist = { record(url: string, now?: number): void; items(): Array<{ url: string; visits: number }> }
type SyncMore = Sync & { otherDevices(): Array<{ name: string; tabs: Array<{ url: string; kind: string }> }> }

async function launchWithSettings(googleBase: string, settings: object, args: string[] = []) {
  const userData = mkdtempSync(join(tmpdir(), 'ib-sync2-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, ...args],
    env: { ...process.env, INSTANT_TEST_PINS: '1', INSTANT_TEST_NO_POLL: '1', INSTANT_TEST_GOOGLE_BASE: googleBase, INSTANT_TEST_GOOGLE_ID: 'id', INSTANT_TEST_GOOGLE_SECRET: 'secret' }
  })
  apps.push(app)
  await expect.poll(() => app.evaluate(() => !!(globalThis as Record<string, unknown>).__sync), { timeout: 15_000 }).toBe(true)
  return app
}
const bookmarks = (a: ElectronApplication) => a.evaluate(() => (globalThis as unknown as { __bookmarks: Bm }).__bookmarks.list())
const histItems = (a: ElectronApplication) => a.evaluate(() => (globalThis as unknown as { __ownHistory: Hist }).__ownHistory.items())
const devicesOf = (a: ElectronApplication) => a.evaluate(() => (globalThis as unknown as { __sync: SyncMore }).__sync.otherDevices())
const clickStar = (a: ElectronApplication) =>
  a.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'bookmark'})")
    }
  })

test('bookmarks, history and open pages travel between two computers; Sync now works from the bubble; quitting sends the last change', async () => {
  const drive = await startFakeGoogle()
  try {
    // Computer A: a page is open, history on, open pages on.
    const a = await launchWithSettings(drive.base, { syncHistory: true, syncOpenPages: true, deviceName: 'Work Mac' }, [`${base}/`])
    await expect.poll(() => a.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'Synced page'))).toBe(true)
    await new Promise((r) => setTimeout(r, 600))
    await call(a, 'connect')
    await expect.poll(async () => (await status(a)).state, { timeout: 15_000 }).toBe('needs-passphrase')
    await withPassphrase(a, 'setPassphrase', PASSPHRASE)
    await expect.poll(async () => (await status(a)).state, { timeout: 15_000 }).toBe('idle')

    // The star bookmarks the page; the history has a visit.
    await clickStar(a)
    await expect.poll(async () => (await bookmarks(a)).length).toBe(1)
    await a.evaluate(() => (globalThis as unknown as { __ownHistory: Hist }).__ownHistory.record('https://history.example/visited'))
    await call(a, 'syncNow')

    // Computer B: history on, open pages on, a different name.
    const b = await launchWithSettings(drive.base, { syncHistory: true, syncOpenPages: true, deviceName: 'Home PC' })
    await call(b, 'connect')
    await expect.poll(async () => (await status(b)).state, { timeout: 15_000 }).toBe('locked')
    await withPassphrase(b, 'unlock', PASSPHRASE)
    await expect.poll(async () => (await bookmarks(b)).length, { timeout: 15_000 }).toBe(1)
    expect((await bookmarks(b))[0]!.url).toBe(`${base}/`) // ONE bookmark, the same page
    expect((await histItems(b)).map((h) => h.url)).toContain('https://history.example/visited')
    const others = await devicesOf(b)
    expect(others.map((d) => d.name)).toEqual(['Work Mac'])
    expect(others[0]!.tabs.some((t) => t.url === `${base}/` && t.kind === 'window')).toBe(true) // A's open page, seen on B

    // The shared file is scrambled: no address, no history in it.
    const text = [...drive.files.values()].map((f) => f.body).join('')
    expect(text).not.toContain('history.example')
    expect(text).not.toContain(base)

    // "Sync now" from its own round bubble beside the search bar (left of the Pin Manager bubble).
    await a.evaluate(() => (globalThis as unknown as { __searchBar: { show(): void } }).__searchBar.show())
    const before = await status(a)
    await expect.poll(async () => a.evaluate(async ({ webContents }) => {
      const bubble = webContents.getAllWebContents().find((w) => w.getURL().endsWith('#sync'))
      return bubble ? ((await bubble.executeJavaScript("document.getElementById('bubble')?.getAttribute('aria-label')")) as string) : ''
    }), { timeout: 8000 }).toMatch(/^Sync now/)
    await a.evaluate(async ({ webContents }) => {
      await webContents.getAllWebContents().find((w) => w.getURL().endsWith('#sync'))?.executeJavaScript("document.getElementById('bubble').click()")
    })
    await expect.poll(async () => (await status(a)).lastSyncAt, { timeout: 15_000 }).toBeGreaterThan(before.lastSyncAt ?? 0)

    // A removes the bookmark and quits at once. The last change is sent before the app ends.
    const versionBefore = [...drive.files.values()][0]!.version
    await clickStar(a)
    await expect.poll(async () => (await bookmarks(a)).length).toBe(0)
    await a.close() // quitting: the app saves its pins, then sends the last changes to Drive (at most 4 seconds)
    expect([...drive.files.values()][0]!.version).toBeGreaterThan(versionBefore)
    await call(b, 'syncNow')
    await expect.poll(async () => (await bookmarks(b)).length, { timeout: 15_000 }).toBe(0) // B sees it
  } finally {
    await drive.close()
  }
})

test('the passphrase wizard: a window with steps, password-manager hints, and a refusal of weak passphrases', async () => {
  const drive = await startFakeGoogle()
  try {
    const a = await launchWithSettings(drive.base, {})
    await call(a, 'connect')
    await expect.poll(async () => (await status(a)).state, { timeout: 15_000 }).toBe('needs-passphrase')
    const inSettings = <T>(code: string) => a.evaluate(async ({ webContents }, src) => {
      const settingsPage = () => webContents.getAllWebContents().find((w) => w.getURL().includes('/settings/'))
      if (!settingsPage()) {
        const bar = webContents.getAllWebContents().find((w) => w.getURL().includes('/search/'))
        await bar?.executeJavaScript("window.instantSearch?.openSettings('Sync')").catch(() => {})
      }
      const wc = settingsPage()
      return wc ? ((await wc.executeJavaScript(src).catch(() => null)) as unknown) : null
    }, code) as Promise<T | null>
    // open the window from the Sync section
    await expect.poll(async () => inSettings<boolean>(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Choose a passphrase/.test(x.textContent)); if (!b) return false; b.click(); return !!document.querySelector('.modal-backdrop') })()`), { timeout: 15_000, intervals: [300] }).toBe(true)
    const fields = await inSettings<Array<{ ac: string | null; type: string }>>(`Array.from(document.querySelectorAll('.modal-backdrop input[type=password], .modal-backdrop input[type=text]')).map((i) => ({ ac: i.getAttribute('autocomplete'), type: i.type }))`)
    expect(fields!.some((f) => f.ac === 'new-password')).toBe(true) // password managers see a new password
    // a common passphrase is refused, with the reason
    const message = await inSettings<string>(`(() => { const ins = document.querySelectorAll('.modal-backdrop input[name^=sync-passphrase]'); ins.forEach((i) => { i.value = 'aaaaaaaaaaaaaaaa'; i.dispatchEvent(new Event('input', { bubbles: true })) }); document.querySelector('.modal-backdrop button.primary')?.click(); return document.querySelector('.modal-backdrop .hint.warn')?.textContent || '' })()`)
    expect(message).not.toBe('')
  } finally {
    await drive.close()
  }
})
