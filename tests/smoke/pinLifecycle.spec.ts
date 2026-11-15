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
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<title>Pin me</title><h1>hello</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  await app?.close()
  server.close()
})

type Box = { x: number; y: number; width: number; height: number }
const pins = () => app.evaluate(() => (globalThis as unknown as { __pins: { pins(): Array<{ id: string; label: string | null; pin: { x: number; y: number }; url: string; state: string; following: boolean; gradient: unknown; archived: boolean }> } }).__pins.pins())
const liveIds = () => app.evaluate(() => (globalThis as unknown as { __pins: { liveIds(): string[] } }).__pins.liveIds())
const phase = (id: string) => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: { windowOf(id: string): { debug(): { phase: string } } } }).__pins.windowOf(pinId).debug().phase, id)
const circle = (id: string) => app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: { windowOf(id: string): { view(): { circle: Box } } } }).__pins.windowOf(pinId).view().circle, id)
const visibleMini = () => app.evaluate(({ BaseWindow, BrowserWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible() && !(w instanceof BrowserWindow)).length)
const pageMarker = () =>
  app.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((w) => w.getURL().startsWith('http://127.0.0.1'))
    return page ? ((await page.executeJavaScript('window.__marker')) as string | undefined) : 'no page'
  })
/** The pin page may still be loading: move the pointer again until the pin reacts. */
const arm = async (id: string) => {
  // Only move while idle: once the pin opens, the circle sits somewhere else in the larger window, as it does for a real pointer.
  await expect.poll(async () => { if ((await phase(id)) === 'idle') await pointer('mouseMove', 28, 28); return phase(id) }, { timeout: 8000 }).not.toBe('idle')
  // A real pointer stays on the circle while the window grows around it: keep sending moves to the circle's current place.
  await expect.poll(async () => {
    const c = await circle(id)
    await pointer('mouseMove', Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2))
    return phase(id)
  }, { timeout: 6000, intervals: [150] }).toBe('armed')
}
/** The toolbar of the window the user can see (a hidden spare window has one too). */
const toolbarAction = (action: object) =>
  app.evaluate(async ({ BaseWindow, BrowserWindow }, a) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      await bar?.webContents.executeJavaScript(`window.instantToolbar.action(${JSON.stringify(a)})`)
    }
  }, action)
const pointer = (type: 'mouseMove' | 'click', x: number, y: number) =>
  app.evaluate(({ webContents }, p) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
    wc?.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    if (p.type === 'click') {
      wc?.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
      wc?.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    }
  }, { type, x, y })

test('Collapse keeps the page alive behind a pin; clicking the armed pin restores the same page', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ib-pinlife-'))
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, `${base}/`], env: { ...process.env, INSTANT_TEST_PINS: '1' } })
  await expect.poll(visibleMini).toBe(1)
  await expect.poll(pageMarker).toBeUndefined() // the page has loaded (and has no marker yet)
  await app.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((w) => w.getURL().startsWith('http://127.0.0.1'))
    await page?.executeJavaScript("window.__marker = 'same page'")
  })

  // Where the Collapse button is on screen now: the pin must take exactly that place.
  const button = await app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      const r = (await bar?.webContents.executeJavaScript("(() => { const r = document.getElementById('collapse').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width } })()")) as { x: number; y: number; w: number }
      const c = win.getContentBounds()
      return { x: c.x + r.x, y: c.y + r.y, w: r.w }
    }
    return null
  })
  expect(button?.w).toBe(28) // the pin is the same size as that button

  await toolbarAction({ type: 'collapse' })
  await expect.poll(async () => (await liveIds()).length, { timeout: 8000 }).toBe(1)
  await expect.poll(visibleMini).toBe(0) // the window is hidden...
  const placed = (await pins())[0] as unknown as { pin: { x: number; y: number } }
  expect(Math.abs(placed.pin.x - button!.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(placed.pin.y - button!.y)).toBeLessThanOrEqual(1)
  expect(await pageMarker()).toBe('same page') // ...but its page is still alive
  const [first] = await pins()
  expect(first).toMatchObject({ url: `${base}/`, state: 'resident', archived: false })

  // The pin must arm for 2 seconds before it takes the click.
  const id = first!.id
  await arm(id)
  const c = await circle(id)
  await pointer('click', Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2))

  await expect.poll(async () => (await liveIds()).length).toBe(0)
  await expect.poll(visibleMini).toBe(1)
  expect(await pageMarker()).toBe('same page') // restored, not reloaded
  expect(await pins()).toEqual([]) // an expanded window is not a pin

  // Collapsing the same window again gives the pin the same colours.
  await new Promise((r) => setTimeout(r, 900)) // the window is still growing out of the pin; a click during that is ignored
  await toolbarAction({ type: 'collapse' })
  await expect.poll(async () => (await liveIds()).length).toBe(1)
  const [again] = await pins()
  expect(again!.gradient).toEqual(first!.gradient)
})

/** Where the Collapse button of the visible window is on the screen (its centre). */
const buttonNow = () =>
  app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    for (const win of BaseWindow.getAllWindows()) {
      if (win instanceof BrowserWindow || !win.isVisible()) continue
      const bar = win.contentView.children.find((v) => 'webContents' in v && (v as unknown as { webContents: Electron.WebContents }).webContents.getURL().includes('/toolbar/')) as unknown as { webContents: Electron.WebContents } | undefined
      const r = (await bar?.webContents.executeJavaScript("(() => { const r = document.getElementById('collapse').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()")) as { x: number; y: number }
      const c = win.getContentBounds()
      return { x: c.x + r.x, y: c.y + r.y }
    }
    return null
  })

test('the window opens with its pin button exactly on the pin, even after the pin was moved', async () => {
  await new Promise((r) => setTimeout(r, 900))
  const id = (await liveIds())[0]!
  // Move the pin somewhere else (as a drag would), then open it.
  const target = await app.evaluate(({ screen }, pinId) => {
    const m = (globalThis as unknown as { __pins: { pins(): Array<{ id: string; anchor: { x: number; y: number } | null; window: { width: number; height: number } }>; windowOf(id: string): { centrePoint: { x: number; y: number }; moveTo(p: { x: number; y: number }): void } } }).__pins
    const w = m.windowOf(pinId)
    const record = m.pins().find((p) => p.id === pinId)!
    const area = screen.getDisplayNearestPoint(w.centrePoint).workArea
    // A window must stay on the screen, so it is pushed back if the pin goes too far. Choose a new place where the whole
    // window fits (the pin button is near the right end of the toolbar, so this is a narrow range on a small screen).
    const anchor = record.anchor ?? { x: record.window.width / 2, y: 24 }
    const lowest = area.x + anchor.x
    const highest = area.x + area.width - (record.window.width - anchor.x)
    const wanted = w.centrePoint.x - 160
    const x = wanted >= lowest && wanted <= highest ? wanted : Math.min(highest, Math.max(lowest, w.centrePoint.x + 160))
    const moved = { x: Math.round(Math.min(highest, Math.max(lowest, x))), y: w.centrePoint.y }
    w.moveTo(moved)
    return moved
  }, id)
  await arm(id)
  const c = await circle(id)
  await pointer('click', Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2))
  await expect.poll(async () => (await liveIds()).length).toBe(0)
  await expect.poll(visibleMini).toBe(1)
  await new Promise((r) => setTimeout(r, 1000)) // the window is growing out of the pin
  const button = (await buttonNow())!
  expect(Math.abs(button.x - target.x)).toBeLessThanOrEqual(2) // the pin button is on the pin
  expect(Math.abs(button.y - target.y)).toBeLessThanOrEqual(2)

  // Collapse again, so the next test has a pin.
  await toolbarAction({ type: 'collapse' })
  await expect.poll(async () => (await liveIds()).length, { timeout: 8000 }).toBe(1)
})

test('Rename in place keeps at most 60 characters; Remove archives the pin and closes its page', async () => {
  const [pin] = await pins()
  const id = pin!.id
  await arm(id)

  // Click the name: it becomes a text field. Type a very long name and press Return.
  const description = await app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: { windowOf(id: string): { view(): { parts: { description: Box } } } } }).__pins.windowOf(pinId).view().parts.description, id)
  await pointer('click', Math.round(description.x + 40), Math.round(description.y + description.height / 2))
  const field = () => app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
    return (await wc?.executeJavaScript("(() => { const i = document.getElementById('rename'); return { shown: !i.hidden, focused: document.activeElement === i } })()")) as { shown: boolean; focused: boolean }
  })
  await expect.poll(field).toEqual({ shown: true, focused: true })
  await app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
    await wc?.executeJavaScript("(() => { const i = document.getElementById('rename'); i.maxLength = 500; i.value = 'x'.repeat(100); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) })()")
  })
  await expect.poll(async () => (await pins())[0]!.label?.length).toBe(60)
  await expect.poll(async () => (await field()).shown).toBe(false)

  await arm(id)
  const view = await app.evaluate((_e, pinId) => (globalThis as unknown as { __pins: { windowOf(id: string): { view(): { parts: { remove: Box } } } } }).__pins.windowOf(pinId).view().parts.remove, id)
  await pointer('click', Math.round(view.x + view.width / 2), Math.round(view.y + view.height / 2))
  await expect.poll(async () => (await liveIds()).length).toBe(0)
  expect(await pins()).toEqual([]) // not in the list of pins...
  expect(await pageMarker()).toBe('no page') // ...and the page is gone
  const all = await app.evaluate(() => (globalThis as unknown as { __pins: { archived(): unknown[] } }).__pins.archived().length)
  expect(all).toBe(1) // ...but kept in the archive
})
