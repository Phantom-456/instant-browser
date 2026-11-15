import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let server: Server
let base: string
let hits = 0
let app: ElectronApplication
let userData = ''

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    hits++
    res.setHeader('content-type', 'text/html')
    res.end('<title>Long page</title><h1>hello</h1><input id="note" type="text"><div style="height:4000px"></div>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  await app?.close()
  server.close()
})

type Box = { x: number; y: number; width: number; height: number }
type Pins = {
  pins(): Array<{ id: string; state: string; snapshotAt: number | null; scroll: { x: number; y: number } | null }>
  liveIds(): string[]
  windowOf(id: string): { debug(): { phase: string }; view(): { circle: Box; parts: { offload: Box } } }
  hasPage(id: string): boolean
  offload(id: string, o: { ask: boolean }): Promise<{ ok: boolean; reason?: string }>
}
const pins = () => app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.pins())
const liveIds = () => app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.liveIds())
const hasPage = (id: string) => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.hasPage(pinId), id)
const phase = (id: string) => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.windowOf(pinId).debug().phase, id)
const view = (id: string) => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.windowOf(pinId).view(), id)
const pageCount = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.getURL().startsWith('http://127.0.0.1')).length)
const urls = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()))
const visibleMini = () => app.evaluate(({ BaseWindow, BrowserWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible() && !(w instanceof BrowserWindow)).length)
const pagejs = (code: string) =>
  app.evaluate(async ({ webContents }, c) => {
    const page = webContents.getAllWebContents().find((w) => w.getURL().startsWith('http://127.0.0.1'))
    return page ? await page.executeJavaScript(c) : 'no page'
  }, code)
const toolbarCollapse = () =>
  app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  })
const input = (events: Array<{ type: string; x: number; y: number; button?: string; clickCount?: number; modifiers?: string[] }>) =>
  app.evaluate(({ webContents }, list) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
    for (const e of list) wc?.sendInputEvent(e as never)
  }, events)

/** Hover the pin until it is armed (a real pointer stays on the circle while the window grows). */
async function arm(id: string) {
  await expect.poll(async () => { if ((await phase(id)) === 'idle') await input([{ type: 'mouseMove', x: 28, y: 28 }]); return phase(id) }, { timeout: 8000 }).not.toBe('idle')
  await expect.poll(async () => {
    const c = (await view(id)).circle
    await input([{ type: 'mouseMove', x: Math.round(c.x + c.width / 2), y: Math.round(c.y + c.height / 2) }])
    return phase(id)
  }, { timeout: 6000, intervals: [150] }).toBe('armed')
}

test('Offload frees the page and keeps a picture; opening the pin shows the preview, then the live page at the same scroll', async () => {
  userData = mkdtempSync(join(tmpdir(), 'ib-offload-'))
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, `${base}/`], env: { ...process.env, INSTANT_TEST_PINS: '1' } })
  await expect.poll(visibleMini).toBe(1)
  await expect.poll(() => pagejs('document.readyState')).toBe('complete')
  await pagejs('window.scrollTo(0, 600)')
  await expect.poll(() => pagejs('window.scrollY')).toBe(600)

  await toolbarCollapse()
  await expect.poll(async () => (await liveIds()).length, { timeout: 8000 }).toBe(1)
  const [pin] = await pins()
  const id = pin!.id
  expect(await hasPage(id)).toBe(true)
  expect(await pageCount()).toBe(1)

  // Offload by dragging the bubble below the pin toward the pin.
  await arm(id)
  const v = await view(id)
  const from = { x: Math.round(v.parts.offload.x + v.parts.offload.width / 2), y: Math.round(v.parts.offload.y + v.parts.offload.height / 2) }
  const to = { x: Math.round(v.circle.x + v.circle.width / 2), y: Math.round(v.circle.y + v.circle.height / 2) }
  const steps = Array.from({ length: 8 }, (_, i) => ({ type: 'mouseMove', x: Math.round(from.x + ((to.x - from.x) * (i + 1)) / 8), y: Math.round(from.y + ((to.y - from.y) * (i + 1)) / 8), modifiers: ['leftButtonDown'] }))
  await input([{ type: 'mouseMove', ...from }, { type: 'mouseDown', ...from, button: 'left', clickCount: 1 }, ...steps, { type: 'mouseUp', ...to, button: 'left', clickCount: 1 }])

  await expect.poll(async () => (await pins())[0]?.state, { timeout: 8000 }).toBe('offloaded')
  expect(await hasPage(id)).toBe(false)
  await expect.poll(pageCount).toBe(0) // the page is gone from memory
  const file = join(userData, 'pins', 'snapshots', `${id}.png`)
  expect(existsSync(file)).toBe(true)
  expect(statSync(file).size).toBeGreaterThan(500)
  expect(statSync(file).mode & 0o777).toBe(0o600)
  expect((await pins())[0]!.scroll?.y).toBe(600)

  // Open it again: the window grows, the saved preview shows, then the live page loads and the preview goes.
  const before = hits
  await arm(id)
  const c = (await view(id)).circle
  await input([{ type: 'mouseMove', x: Math.round(c.x + c.width / 2), y: Math.round(c.y + c.height / 2) }, { type: 'mouseDown', x: Math.round(c.x + c.width / 2), y: Math.round(c.y + c.height / 2), button: 'left', clickCount: 1 }, { type: 'mouseUp', x: Math.round(c.x + c.width / 2), y: Math.round(c.y + c.height / 2), button: 'left', clickCount: 1 }])
  await expect.poll(async () => (await urls()).some((u) => u.includes('/preview/')) || hits > before, { timeout: 8000 }).toBe(true)
  await expect.poll(() => hits, { timeout: 10_000 }).toBeGreaterThan(before) // the page was loaded from the network again
  await expect.poll(() => pagejs('window.scrollY'), { timeout: 10_000 }).toBeGreaterThan(550) // and put back where it was
  await expect.poll(async () => (await urls()).some((u) => u.includes('/preview/')), { timeout: 5000 }).toBe(false) // the preview is gone
  await expect.poll(async () => (await pins()).length).toBe(0) // an open window is not a pin
  await expect.poll(visibleMini).toBe(1)
})

test('an automatic Offload does not drop text the user typed and did not send', async () => {
  await new Promise((r) => setTimeout(r, 900)) // the window is still growing out of the pin
  await pagejs("document.getElementById('note').value = 'half written'")
  await toolbarCollapse()
  await expect.poll(async () => (await liveIds()).length, { timeout: 8000 }).toBe(1)
  await expect.poll(visibleMini).toBe(0) // the window has finished shrinking
  await new Promise((r) => setTimeout(r, 300))
  const id = (await liveIds())[0]!
  const result = await app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.offload(pinId, { ask: false }), id)
  expect(result).toEqual({ ok: false, reason: 'unsaved' })
  expect(await hasPage(id)).toBe(true) // still open, nothing lost
  expect((await pins())[0]!.state).toBe('resident')
})
