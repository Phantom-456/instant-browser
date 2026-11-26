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
  server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Fragile</title><h1>fragile</h1>') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => { await app?.close().catch(() => {}); server.close() })

type Pins = {
  pins(): Array<{ id: string; state: string }>
  liveIds(): string[]
  offload(id: string, o: { ask: boolean }): Promise<{ ok: boolean }>
  windowOf(id: string): { view(): { circle: { x: number; y: number; width: number; height: number } }; debug(): { phase: string } }
}
const pinsNow = () => app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.pins())
const liveIds = () => app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.liveIds())
const previewText = () =>
  app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/preview/'))
    return wc ? ((await wc.executeJavaScript('document.body.innerText')) as string) : ''
  })
const pressPreview = (id: string) =>
  app.evaluate(async ({ webContents }, buttonId) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/preview/'))
    await wc?.executeJavaScript(`document.getElementById(${JSON.stringify(buttonId)}).click()`)
  }, id)
/** Visible browser windows. (A released pin's bare shell is a window too, but it holds no page.) */
const visibleMini = () => app.evaluate(({ BaseWindow, BrowserWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible() && !(w instanceof BrowserWindow) && w.contentView.children.some((v) => 'webContents' in v)).length)

test('opening a released pin while the page cannot load shows Retry and Cancel; Cancel gives the pin back', async () => {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-fail-'))}`, `${base}/`],
    env: { ...process.env, INSTANT_TEST_PINS: '1', INSTANT_TEST_NO_POLL: '1', INSTANT_TEST_DEMOTE_MS: '99999999' }
  })
  await expect.poll(async () => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'Fragile'))).toBe(true)
  await new Promise((r) => setTimeout(r, 600))
  await app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  })
  await expect.poll(async () => (await liveIds()).length, { timeout: 10_000 }).toBe(1)
  await new Promise((r) => setTimeout(r, 900))
  const id = (await liveIds())[0]!
  expect((await app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.offload(pinId, { ask: false }), id)).ok).toBe(true)

  // The site goes away. Opening the pin cannot load the page.
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))

  // Arm the pin and click it, as a person would.
  const move = (x: number, y: number, click = false) =>
    app.evaluate(({ webContents }, a) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
      wc?.sendInputEvent({ type: 'mouseMove', x: a.x, y: a.y })
      if (a.click) { wc?.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 }); wc?.sendInputEvent({ type: 'mouseUp', x: a.x, y: a.y, button: 'left', clickCount: 1 }) }
    }, { x, y, click })
  const phase = () => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.windowOf(pinId).debug().phase, id)
  const circle = () => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.windowOf(pinId).view().circle, id)
  await expect.poll(async () => { if ((await phase()) === 'idle') await move(28, 28); return phase() }, { timeout: 8000 }).not.toBe('idle')
  await expect.poll(async () => { const c = await circle(); await move(Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2)); return phase() }, { timeout: 6000, intervals: [150] }).toBe('armed')
  const c = await circle()
  await move(Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2), true)

  // The window opens with the saved preview, then says the page did not load, with Retry and Cancel.
  await expect.poll(async () => (await previewText()).toLowerCase(), { timeout: 15_000 }).toContain('did not load')
  expect(await previewText()).toMatch(/Retry/)
  expect(await previewText()).toMatch(/Cancel/)

  // Retry tries again (still fails), and the window stays open with the preview.
  await pressPreview('retry')
  await expect.poll(async () => (await previewText()).toLowerCase(), { timeout: 15_000 }).toContain('did not load')
  expect(await visibleMini()).toBe(1)

  // Cancel closes the window and the pin comes back, still released.
  await pressPreview('cancel')
  await expect.poll(visibleMini, { timeout: 8000 }).toBe(0)
  await expect.poll(async () => (await liveIds()).length, { timeout: 8000 }).toBe(1)
  expect((await pinsNow())[0]).toMatchObject({ id, state: 'offloaded' })
})
