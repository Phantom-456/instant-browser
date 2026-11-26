import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication

test.afterAll(async () => { await app?.close() })

type Debug = { phase: string; ignoring: boolean; bounds: { x: number; y: number; width: number; height: number }; dragging: boolean }
const state = () => app.evaluate((): Debug => (globalThis as unknown as { __testPin: { pin: { debug(): Debug } } }).__testPin.pin.debug())
const events = () => app.evaluate((): unknown[] => (globalThis as unknown as { __testPin: { events: unknown[] } }).__testPin.events.slice())
/** Move the pointer inside the pin window (a forwarded mouse move, as the system sends while the window ignores clicks). */
const move = (x: number, y: number) =>
  app.evaluate(({ webContents }, p) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
    wc?.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
  }, { x, y })

test('a pin ignores clicks until it has armed for 2 seconds, then takes them', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ib-pin-'))
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, INSTANT_TEST: '1', INSTANT_TEST_PIN: '1' } })
  await expect.poll(async () => (await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getURL().includes('/pin/')))), { timeout: 15_000 }).toBe(true)
  await expect.poll(async () => (await state()).phase).toBe('idle')

  const rest = await state()
  expect(rest.ignoring).toBe(true) // click-through at rest
  // The circle and its shadow room. Windows with display scaling rounds the window to whole pixels and back
  // (a Windows 11 PC reported 58), so a little slack there.
  expect(Math.abs(rest.bounds.width - (28 + 28))).toBeLessThanOrEqual(process.platform === 'win32' ? 2 : 0)

  // Pointer on the middle of the circle: the pin starts to arm, still click-through, and grows.
  // (The page may still be starting, so the move is sent again until the pin reacts.)
  await expect.poll(async () => { if ((await state()).phase === 'idle') await move(28, 28); return (await state()).phase }, { intervals: [100] }).toBe('arming')
  const arming = await state()
  expect(arming.ignoring).toBe(true)
  expect(arming.bounds.width).toBeGreaterThan(rest.bounds.width)

  // Leaving early goes back to idle and shrinks again.
  await move(1, 1)
  await expect.poll(async () => (await state()).phase).toBe('idle')
  // Back to the rest size (at 150 % scaling on Windows the round trip gave 56 here and 58 at start).
  const slack = process.platform === 'win32' ? 2 : 0
  await expect.poll(async () => Math.abs((await state()).bounds.width - rest.bounds.width) <= slack, { timeout: 3000 }).toBe(true)

  // Staying for 2 seconds arms the pin, and then it takes clicks.
  // (A real pointer sends a fresh move when the window changes size; here we send it again until the pin reacts.)
  await expect.poll(async () => { if ((await state()).phase === 'idle') await move(28, 28); return (await state()).phase }, { intervals: [100] }).toBe('arming')
  // The pin has opened. Moving onto the opened capsule (not the circle) still counts as hovering the pin.
  await expect.poll(async () => {
    const v = await app.evaluate((): { parts: { description: { x: number; y: number; width: number; height: number } } | null } => (globalThis as unknown as { __testPin: { pin: { view(): never } } }).__testPin.pin.view())
    const d = v.parts?.description
    if (d) await move(Math.round(d.x + 30), Math.round(d.y + d.height / 2)) // the left part of the capsule, far from the circle
    return (await state()).phase
  }, { timeout: 5000, intervals: [150] }).toBe('armed')
  expect((await state()).ignoring).toBe(false)
})

type Box = { x: number; y: number; width: number; height: number }
const view = () => app.evaluate((): { circle: Box; parts: { follow: Box; remove: Box; offload: Box } } => (globalThis as unknown as { __testPin: { pin: { view(): never } } }).__testPin.pin.view())
const click = (x: number, y: number) =>
  app.evaluate(({ webContents }, p) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
    wc?.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    wc?.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    wc?.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  }, { x, y })
const centre = (b: Box) => ({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) })

test('once armed, the bubbles and the circle send their actions', async () => {
  expect((await state()).phase).toBe('armed')
  const v = await view()
  if (process.platform === 'darwin') {
    const f = centre(v.parts.follow)
    await click(f.x, f.y)
    await expect.poll(events).toContainEqual({ type: 'follow' })
  } else {
    // Following desktops is Mac only (Electron cannot show a window on every Windows desktop): the bubble is hidden.
    const shown = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
      return (await wc?.executeJavaScript("getComputedStyle(document.getElementById('follow')).display")) as string
    })
    expect(shown).toBe('none')
  }
  const r = centre(v.parts.remove)
  await click(r.x, r.y)
  await expect.poll(events).toContainEqual({ type: 'remove' })
  const c = centre(v.circle)
  await click(c.x, c.y)
  await expect.poll(events).toContainEqual({ type: 'restore' })
})

test('the pin page is drawn for the system theme, and shows its phase', async () => {
  const read = () => app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/pin/'))
    return (await wc?.executeJavaScript('document.documentElement.dataset.theme + "|" + document.body.dataset.phase')) as string
  })
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark' })
  await expect.poll(read).toMatch(/^dark\|/)
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light' })
  await expect.poll(read).toMatch(/^light\|/)
})
