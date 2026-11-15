import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let server: Server
let base: string
let app: ElectronApplication
let userData = ''

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<title>Managed page</title><h1>hello</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  await app?.close()
  server.close()
})

type Pins = { pins(): Array<{ id: string; state: string; label: string | null; archived: boolean }>; liveIds(): string[]; archived(): Array<{ id: string }> }
const pins = () => app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.pins())
const archived = () => app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.archived().length)
const liveIds = () => app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.liveIds())
const managerJs = (code: string) =>
  app.evaluate(async ({ webContents }, c) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/manager/'))
    return wc ? await wc.executeJavaScript(c) : 'no manager'
  }, code)
/** The page text in lower case (the group headings are drawn in capitals). */
const text = async () => ((await managerJs('document.body.innerText')) as string).toLowerCase()
/** Press the button with this label inside the row that contains this text. */
const press = (rowText: string, label: string) =>
  managerJs(`(() => { const row = Array.from(document.querySelectorAll('.row')).find((r) => r.textContent.includes(${JSON.stringify(rowText)})); const b = row && Array.from(row.querySelectorAll('button')).find((x) => x.textContent === ${JSON.stringify(label)}); if (b) b.click(); return !!b })()`)

test('the manager lists open windows and pins, and Offload, Rename, Remove, Put back and Delete work from it', async () => {
  userData = mkdtempSync(join(tmpdir(), 'ib-manager-'))
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, `${base}/`], env: { ...process.env, INSTANT_TEST_PINS: '1' } })
  await expect.poll(async () => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'Managed page'))).toBe(true)

  await app.evaluate(() => (globalThis as unknown as { __manager: { open(): void } }).__manager.open())
  await expect.poll(async () => (await text()).includes('open windows (1)'), { timeout: 8000 }).toBe(true)
  expect(await text()).toContain('managed page') // the open window is listed, with its title

  // Collapse the window: it becomes a pin in the list, with its page in memory.
  await app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  })
  await expect.poll(async () => (await text()).includes('pins (1)'), { timeout: 10_000 }).toBe(true)
  await expect.poll(async () => (await text()).includes('open windows (0)')).toBe(true)
  expect(await text()).toContain('page in memory')
  await new Promise((r) => setTimeout(r, 900)) // the shrink animation

  // Offload from the list: the page is released.
  expect(await press('Managed page', 'Offload')).toBe(true)
  await expect.poll(async () => (await pins())[0]?.state, { timeout: 8000 }).toBe('offloaded')
  await expect.poll(async () => (await text()).includes('page released')).toBe(true)

  // Rename from the list.
  await managerJs("window.instantManager.action({ type: 'rename', id: " + JSON.stringify((await pins())[0]!.id) + ", text: 'My docs' })")
  await expect.poll(async () => (await text()).includes('my docs')).toBe(true)

  // Details open a small panel.
  expect(await press('My docs', 'Details')).toBe(true)
  await expect.poll(async () => (await text()).includes('last used')).toBe(true)

  // Remove goes to the archive (kept), and the pin leaves the screen.
  expect(await press('My docs', 'Remove')).toBe(true)
  await expect.poll(archived).toBe(1)
  await expect.poll(async () => (await text()).includes('archive (1)')).toBe(true)
  expect(await liveIds()).toHaveLength(0)

  // Put back: the pin is on the screen again, released.
  expect(await press('My docs', 'Put back')).toBe(true)
  await expect.poll(async () => (await liveIds()).length).toBe(1)
  await expect.poll(async () => (await text()).includes('pins (1)')).toBe(true)
  expect((await pins())[0]).toMatchObject({ state: 'offloaded', label: 'My docs', archived: false })

  // Delete for good: it asks first (we answer "Delete for good" for the test), then the record is gone.
  expect(await press('My docs', 'Remove')).toBe(true)
  await expect.poll(archived).toBe(1)
  await app.evaluate(({ dialog }) => {
    ;(dialog as unknown as { showMessageBox: (...a: unknown[]) => Promise<{ response: number }> }).showMessageBox = async () => ({ response: 1 })
  })
  expect(await press('My docs', 'Delete for good')).toBe(true)
  await expect.poll(archived).toBe(0)
  const file = join(userData, 'pins', 'pins.json')
  expect(existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).pins.length).toBe(0)
})
