import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let server: Server
let base: string
let app: ElectronApplication

test.beforeAll(async () => {
  server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Shell page</title><h1>shell</h1>') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  await app?.close()
  server.close()
})

type Pins = {
  liveIds(): string[]
  surfaceState(id: string): { window: boolean; shell: boolean } | null
  pollHoverAt(p: { x: number; y: number }, now?: number): void
  windowOf(id: string): { centrePoint: { x: number; y: number }; debug(): { phase: string } }
  offload(id: string, o: { ask: boolean }): Promise<{ ok: boolean }>
}
const surface = (id: string) => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.surfaceState(pinId), id)
const pagesOfPins = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.getURL().includes('/pin/')).length)
const tabProcesses = () => app.evaluate(({ app: a }) => a.getAppMetrics().filter((p) => p.type === 'Tab').length)

test('a released pin has no page process until the pointer is on it, and gives it up again when the pointer has gone', async () => {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-shell-'))}`, `${base}/`],
    env: { ...process.env, INSTANT_TEST_PINS: '1', INSTANT_TEST_NO_POLL: '1', INSTANT_TEST_DEMOTE_MS: '300' } // the test plays the pointer itself
  })
  await expect.poll(async () => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'Shell page'))).toBe(true)
  await new Promise((r) => setTimeout(r, 600))
  await app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  })
  await expect.poll(async () => (await app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.liveIds())).length, { timeout: 10_000 }).toBe(1)
  await new Promise((r) => setTimeout(r, 900))
  const id = (await app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.liveIds()))[0]!

  // A pin with a live page has its own pin window.
  expect(await surface(id)).toEqual({ window: true, shell: false })
  const withWindow = await tabProcesses()

  // Offload it. The pin window stays while it is in use, then (pointer gone) it is let go and the bare shell takes over.
  expect((await app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.offload(pinId, { ask: false }), id)).ok).toBe(true)
  const centre = await app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.windowOf(pinId).centrePoint, id)
  const far = { x: centre.x + 800, y: centre.y + 500 }
  await expect.poll(async () => {
    await app.evaluate((_e, p) => (globalThis as unknown as { __pins: Pins }).__pins.pollHoverAt(p), far)
    return surface(id)
  }, { timeout: 8000, intervals: [200] }).toEqual({ window: false, shell: true })
  expect(await pagesOfPins()).toBe(0) // no page behind the resting pin
  expect(await tabProcesses()).toBeLessThan(withWindow + 0) // fewer page processes than with a live pin (the page and the pin page are gone)

  // The pointer comes onto the pin: a real pin window starts and begins to arm; the shell stays until it has drawn.
  await app.evaluate((_e, p) => (globalThis as unknown as { __pins: Pins }).__pins.pollHoverAt(p), centre)
  await expect.poll(() => surface(id).then((s) => s?.window)).toBe(true)
  await expect.poll(async () => (await pagesOfPins())).toBe(1)
  await expect.poll(async () => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.windowOf(pinId).debug().phase, id), { timeout: 4000 }).not.toBe('idle')
  await expect.poll(() => surface(id).then((s) => s?.shell), { timeout: 5000 }).toBe(false) // the bare shell went when the window had drawn
})
