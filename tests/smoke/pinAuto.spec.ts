import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let server: Server
let base: string
let app: ElectronApplication

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    if (req.url === '/two') res.end('<title>Second</title><h1>two</h1>')
    else res.end('<title>First</title><a id="open" href="/two" target="_blank">open</a>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterEach(async () => { await app?.close() })
test.afterAll(() => { server.close() })

type Box = { x: number; y: number; width: number; height: number }
type Pins = {
  pins(): Array<{ id: string; state: string; url: string }>
  liveIds(): string[]
  windowOf(id: string): { debug(): { phase: string }; view(): { circle: Box; parts: { offload: Box }; countdown: { mode: string } } }
  automation: { toggle(id: string): void }
}
const pins = () => app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.pins())
const liveIds = () => app.evaluate(() => (globalThis as unknown as { __pins: Pins }).__pins.liveIds())
const view = (id: string) => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.windowOf(pinId).view(), id)
const phase = (id: string) => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.windowOf(pinId).debug().phase, id)
const visibleMini = () => app.evaluate(({ BaseWindow, BrowserWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible() && !(w instanceof BrowserWindow)).length)
const collapseAll = () =>
  app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  })

function launch(settings: object, env: Record<string, string>, args: string[] = []) {
  const userData = mkdtempSync(join(tmpdir(), 'ib-auto-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
  return electron.launch({ args: ['.', `--user-data-dir=${userData}`, ...args], env: { ...process.env, INSTANT_TEST_PINS: '1', INSTANT_TEST_AUTOTICK: '150', ...env } })
}

test('time: a collapsed pin that is not used is offloaded; a paused countdown stays until it goes on', async () => {
  app = await launch({ autoOffloadInactivity: true }, { INSTANT_TEST_OFFLOAD_MS: '2500' }, [`${base}/`])
  await expect.poll(visibleMini).toBe(1)
  await expect.poll(async () => ((await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getURL().startsWith('http://127.0.0.1')))) as boolean)).toBe(true)
  await collapseAll()
  await expect.poll(async () => (await liveIds()).length, { timeout: 8000 }).toBe(1)
  const id = (await liveIds())[0]!

  // The user pauses the countdown (what a click on the Offload bubble does).
  await expect.poll(async () => (await view(id)).countdown.mode, { timeout: 5000 }).toBe('running')
  await app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.automation.toggle(pinId), id)
  await expect.poll(async () => (await view(id)).countdown.mode).toBe('paused')
  await new Promise((r) => setTimeout(r, 4000)) // longer than the whole countdown
  expect((await pins())[0]!.state).toBe('resident') // a paused pin is never offloaded

  // Going on: it runs out and the pin is offloaded by itself.
  await app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.automation.toggle(pinId), id)
  await expect.poll(async () => (await pins())[0]?.state, { timeout: 10_000 }).toBe('offloaded')
})

/** Collapse the window whose page has this title. */
const collapseTitled = (title: string) =>
  app.evaluate(async ({ BaseWindow, BrowserWindow }, t) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const views = win.contentView.children.map((v) => (v as unknown as { webContents: Electron.WebContents }).webContents)
      if (!views.some((w) => w.getTitle() === t)) continue
      await views.find((w) => w.getURL().includes('/toolbar/'))?.executeJavaScript("window.instantToolbar.action({type:'collapse'})")
    }
  }, title)

test('memory: over the limit, the oldest pin goes first, but a pin with a paused countdown is skipped', async () => {
  app = await launch(
    { autoOffloadInactivity: true, autoOffloadMemory: true, autoOffloadMemoryGB: 0.5, memoryAsk: false },
    { INSTANT_TEST_OFFLOAD_MS: '1000000000', INSTANT_TEST_MEMORY_MB: '100' }, // memory is fine at first
    [`${base}/`]
  )
  await expect.poll(visibleMini).toBe(1)
  await expect.poll(async () => ((await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'First'))) as boolean)).toBe(true)
  await app.evaluate(async ({ webContents }) => {
    await webContents.getAllWebContents().find((w) => w.getTitle() === 'First')?.executeJavaScript("document.getElementById('open').click()", true)
  })
  await expect.poll(visibleMini).toBe(2)
  await expect.poll(async () => ((await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'Second'))) as boolean)).toBe(true)

  // "First" is collapsed first, so it is the older pin.
  await collapseTitled('First')
  await expect.poll(async () => (await liveIds()).length, { timeout: 10_000 }).toBe(1)
  await new Promise((r) => setTimeout(r, 1200))
  await collapseTitled('Second')
  await expect.poll(async () => (await liveIds()).length, { timeout: 10_000 }).toBe(2)
  await new Promise((r) => setTimeout(r, 1000))
  const all = await pins()
  const older = all.find((p) => p.url.endsWith('/'))!
  const newer = all.find((p) => p.url.endsWith('/two'))!

  // The user pauses the older pin. Then memory goes over the limit.
  await expect.poll(async () => (await view(older.id)).countdown.mode, { timeout: 5000 }).toBe('running')
  await app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: Pins }).__pins.automation.toggle(pinId), older.id)
  await app.evaluate(() => { process.env.INSTANT_TEST_MEMORY_MB = '3000' })

  // The newer pin is offloaded, although the older one would come first: it is paused.
  await expect.poll(async () => (await pins()).find((p) => p.id === newer.id)?.state, { timeout: 15_000 }).toBe('offloaded')
  expect((await pins()).find((p) => p.id === older.id)!.state).toBe('resident')
})

test('memory with "ask first": a notice asks, and the oldest pin is offloaded only after the user says yes', async () => {
  app = await launch(
    { autoOffloadMemory: true, autoOffloadMemoryGB: 0.5, memoryAsk: true },
    { INSTANT_TEST_MEMORY_MB: '100' },
    [`${base}/`]
  )
  await expect.poll(visibleMini).toBe(1)
  await expect.poll(async () => ((await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'First'))) as boolean)).toBe(true)
  // The notice is a system dialog: answer it ourselves ("Offload") and keep what it said.
  await app.evaluate(({ dialog }) => {
    ;(globalThis as Record<string, unknown>).__asked = []
    ;(dialog as unknown as { showMessageBox: (o: { message: string; buttons: string[] }) => Promise<{ response: number }> }).showMessageBox = async (o) => {
      ;((globalThis as Record<string, unknown>).__asked as unknown[]).push(o)
      return { response: 0 }
    }
  })
  await collapseTitled('First')
  await expect.poll(async () => (await liveIds()).length, { timeout: 10_000 }).toBe(1)
  await new Promise((r) => setTimeout(r, 1000))
  expect((await pins())[0]!.state).toBe('resident') // memory is fine: no notice, nothing offloaded
  await app.evaluate(() => { process.env.INSTANT_TEST_MEMORY_MB = '3000' })
  await expect.poll(async () => (await pins())[0]?.state, { timeout: 15_000 }).toBe('offloaded')
  const asked = (await app.evaluate(() => (globalThis as Record<string, unknown>).__asked)) as Array<{ message: string; buttons: string[] }>
  expect(asked.some((o) => o.message.includes('Memory use is high') && o.buttons[0]!.startsWith('Offload'))).toBe(true)
})
