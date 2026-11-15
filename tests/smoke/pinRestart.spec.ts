import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let server: Server
let base: string
let app: ElectronApplication | undefined

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<title>Keep me</title><h1>hello</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterEach(async () => { await app?.close().catch(() => {}) })
test.afterAll(() => { server.close() })

type Pins = {
  pins(): Array<{ id: string; state: string; pin: { x: number; y: number }; url: string }>
  liveIds(): string[]
  hasPage(id: string): boolean
}

test('pins survive a restart as border-only pins with their saved picture, and come back onto the screen', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ib-restart-'))
  const env = { ...process.env, INSTANT_TEST_PINS: '1', INSTANT_TEST_NO_POLL: '1' }

  // First run: collapse a window to a pin, then quit.
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, `${base}/`], env })
  await expect.poll(async () => app!.evaluate(({ BaseWindow, BrowserWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible() && !(w instanceof BrowserWindow)).length)).toBe(1)
  await expect.poll(async () => app!.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'Keep me'))).toBe(true)
  await app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  })
  await expect.poll(async () => app!.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.liveIds().length), { timeout: 8000 }).toBe(1)
  await new Promise((r) => setTimeout(r, 800))
  await app.close()
  app = undefined

  // What was saved at quit: the pin as offloaded, and a picture.
  const saved = JSON.parse(readFileSync(join(userData, 'pins', 'pins.json'), 'utf8')) as { version: number; pins: Array<{ id: string; state: string; snapshotAt: number | null; pin: { x: number; y: number } }> }
  expect(saved.version).toBe(1)
  expect(saved.pins).toHaveLength(1)
  expect(saved.pins[0]!.state).toBe('offloaded')
  const picture = join(userData, 'pins', 'snapshots', `${saved.pins[0]!.id}.png`)
  expect(existsSync(picture)).toBe(true)
  expect(statSync(picture).size).toBeGreaterThan(500)

  // The pin was left far outside every screen (a display was unplugged while the app was closed).
  saved.pins[0]!.pin = { x: 99999, y: 99999 }
  writeFileSync(join(userData, 'pins', 'pins.json'), JSON.stringify(saved))

  // Second run: no window, but the pin is back, border only, on screen.
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env })
  await expect.poll(async () => app!.evaluate(() => (globalThis as unknown as { __pins?: Pins }).__pins?.liveIds().length ?? 0), { timeout: 10_000 }).toBe(1)
  const result = await app.evaluate(({ screen }) => {
    const manager = (globalThis as unknown as { __pins: Pins }).__pins
    const [pin] = manager.pins()
    const area = screen.getDisplayNearestPoint(pin!.pin).workArea
    const inside = pin!.pin.x >= area.x && pin!.pin.x <= area.x + area.width && pin!.pin.y >= area.y && pin!.pin.y <= area.y + area.height
    return { state: pin!.state, hasPage: manager.hasPage(pin!.id), inside, url: pin!.url }
  })
  expect(result).toEqual({ state: 'offloaded', hasPage: false, inside: true, url: `${base}/` })
  // A released pin has NO page process while nobody touches it: only the bare shell is on screen.
  const pinPages = () => app!.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => w.getURL().includes('/pin/')).length)
  expect(await pinPages()).toBe(0)
  // Starting the pin window (what the pointer on the pin does) gives the border-only look.
  await app.evaluate(() => { const m = (globalThis as unknown as { __pins: Pins & { windowOf(id: string): unknown } }).__pins; m.windowOf(m.liveIds()[0]!) })
  await expect.poll(async () => app!.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
    return (await wc?.executeJavaScript("document.getElementById('circle').dataset.state")) as string
  })).toBe('offloaded')
})

test('clampAll brings a pin back when its display is gone', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ib-clamp-'))
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, `${base}/`], env: { ...process.env, INSTANT_TEST_PINS: '1' } })
  await expect.poll(async () => app!.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'Keep me'))).toBe(true)
  await app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  })
  await expect.poll(async () => app!.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.liveIds().length), { timeout: 8000 }).toBe(1)
  await new Promise((r) => setTimeout(r, 800))
  // Pretend the pin sits on a display that was unplugged, then tell the app the displays changed.
  const inside = await app.evaluate(({ screen }) => {
    const manager = (globalThis as unknown as { __pins: Pins & { windowOf(id: string): { moveTo(p: { x: number; y: number }): void }; clampAll(): void } }).__pins
    const id = manager.liveIds()[0]!
    manager.windowOf(id).moveTo({ x: 80000, y: 80000 })
    manager.clampAll()
    const [pin] = manager.pins()
    const area = screen.getDisplayNearestPoint(pin!.pin).workArea
    return pin!.pin.x <= area.x + area.width && pin!.pin.y <= area.y + area.height && pin!.pin.x >= area.x && pin!.pin.y >= area.y
  })
  expect(inside).toBe(true)
})
