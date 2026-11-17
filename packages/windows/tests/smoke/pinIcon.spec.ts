import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// An 8x8 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGO4o6HxHx9mGBkKAIMRisGi/0sOAAAAAElFTkSuQmCC', 'base64')
let server: Server
let base: string
let app: ElectronApplication | undefined

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/fav.png') { res.setHeader('content-type', 'image/png'); res.end(PNG); return }
    res.setHeader('content-type', 'text/html')
    if (req.url === '/plain') res.end('<title>No icon</title><h1>no icon</h1>')
    else res.end('<title>With icon</title><link rel="icon" href="/fav.png"><h1>icon</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterEach(async () => { await app?.close().catch(() => {}); app = undefined })
test.afterAll(() => { server.close() })

type Pins = { pins(): Array<{ id: string; icon: string | null }>; liveIds(): string[] }
async function collapsedPin(path: string, title: string) {
  app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-icon-'))}`, `${base}${path}`], env: { ...process.env, INSTANT_TEST_PINS: '1' } })
  await expect.poll(async () => app!.evaluate(({ webContents }, t) => webContents.getAllWebContents().some((w) => w.getTitle() === t), title)).toBe(true)
  await new Promise((r) => setTimeout(r, 600))
  await app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  })
  await expect.poll(async () => app!.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.liveIds().length), { timeout: 10_000 }).toBe(1)
  return (await app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.pins()))[0]!
}
const pinPageHas = (selector: string) =>
  app!.evaluate(async ({ webContents }, s) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
    return (await wc?.executeJavaScript(`!!document.querySelector(${JSON.stringify(s)})`)) as boolean
  }, selector)

test('a page with its own icon: the pin keeps a small copy and shows it instead of the pin icon', async () => {
  const pin = await collapsedPin('/', 'With icon')
  expect(pin.icon).toMatch(/^data:image\/png;base64,/)
  await expect.poll(() => pinPageHas('#icon img')).toBe(true)
})

test('a page without an icon: the pin keeps the pin icon', async () => {
  const pin = await collapsedPin('/plain', 'No icon')
  expect(pin.icon).toBeNull()
  await expect.poll(() => pinPageHas('#icon svg')).toBe(true)
  expect(await pinPageHas('#icon img')).toBe(false)
})
