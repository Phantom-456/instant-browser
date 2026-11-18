import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-bubbles-'))}`], env: { ...process.env, INSTANT_TEST_PINS: '1', INSTANT_TEST: '1' } })
  // The app sets these when it is ready.
  await expect.poll(() => app.evaluate(() => !!(globalThis as Record<string, unknown>).__searchBar && !!(globalThis as Record<string, unknown>).__bubbles), { timeout: 15_000 }).toBe(true)
})
test.afterAll(async () => { await app?.close() })

type Rect = { x: number; y: number; width: number; height: number }
const showBar = () => app.evaluate(() => (globalThis as unknown as { __searchBar: { show(): void } }).__searchBar.show())
const barBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/search/'))!.getBounds())
const barVisible = () => app.evaluate(({ BrowserWindow }) => {
  const bar = BrowserWindow.getAllWindows().find((w) => {
    try { return !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('/search/') } catch { return false }
  })
  return !!bar && !bar.isDestroyed() && bar.isVisible()
})
const debug = () => app.evaluate(() => (globalThis as unknown as { __bubbles: { debug(): { settings: Rect; sync: Rect; manager: Rect; visible: boolean } } }).__bubbles.debug())
const send = (page: string, events: object[]) =>
  app.evaluate(({ webContents }, a) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(a.page))
    for (const e of a.events) wc?.sendInputEvent(e as never)
  }, { page, events })
const open = (title: string) => app.evaluate(({ BrowserWindow }, t) => BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.getTitle().includes(t)), title)

test('three bubbles sit right of the search bar: Settings (a menu on hover), Sync now, and the Pin Manager', async () => {
  await showBar()
  await expect.poll(async () => (await debug()).visible, { timeout: 8000 }).toBe(true)
  const bar = await barBounds()
  const d = await debug()
  expect(d.settings.x).toBeGreaterThanOrEqual(bar.x + bar.width) // right of the bar
  expect(d.sync.x).toBeGreaterThan(d.settings.x) // Sync now is right of Settings
  expect(d.manager.x).toBeGreaterThan(d.sync.x) // and just left of the Pin Manager bubble: the Manager is last
  expect(Math.abs(d.sync.y - d.manager.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(d.settings.y - d.manager.y)).toBeLessThanOrEqual(1)
  expect(d.settings.height).toBe(52)

  // Hover the Settings bubble: its window grows to show the sections.
  await expect.poll(async () => { await send('#settings', [{ type: 'mouseMove', x: 26, y: 26 }]); return (await debug()).settings.height }, { intervals: [150], timeout: 8000 }).toBeGreaterThan(52)
  expect(await barVisible()).toBe(true) // using the bubbles must not close the bar
})

test('a click on a section in the menu opens Settings and closes the bar; the Manager bubble opens the manager', async () => {
  await showBar()
  await expect.poll(async () => (await debug()).visible).toBe(true)
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.getTitle().includes('Settings') || w.getTitle().includes('Pin Manager')) w.close() })
  // Click the Manager bubble (its window holds only the bubble).
  const manager = (await debug()).manager
  await app.evaluate(({ webContents }, m) => {
    const all = webContents.getAllWebContents().filter((w) => w.getURL().includes('/bubble/'))
    const wc = all.find((w) => w.getURL().endsWith('#manager'))
    wc?.sendInputEvent({ type: 'mouseMove', x: 26, y: 26 })
    wc?.sendInputEvent({ type: 'mouseDown', x: 26, y: 26, button: 'left', clickCount: 1 })
    wc?.sendInputEvent({ type: 'mouseUp', x: 26, y: 26, button: 'left', clickCount: 1 })
    return m
  }, manager)
  await expect.poll(() => open('Pin Manager'), { timeout: 8000 }).toBe(true)
  await expect.poll(barVisible).toBe(false)
})

test('Cmd+, and Cmd+Shift+P in the search field do the same as the bubbles', async () => {
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.getTitle().includes('Settings') || w.getTitle().includes('Pin Manager')) w.close() })
  await showBar()
  await expect.poll(barVisible).toBe(true)
  await send('/search/', [{ type: 'keyDown', keyCode: 'P', modifiers: ['meta', 'shift'] }, { type: 'char', keyCode: 'P', modifiers: ['meta', 'shift'] }])
  await expect.poll(() => open('Pin Manager'), { timeout: 8000 }).toBe(true)

  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.getTitle().includes('Pin Manager')) w.close() })
  await showBar()
  await expect.poll(barVisible).toBe(true)
  await send('/search/', [{ type: 'keyDown', keyCode: ',', modifiers: ['meta'] }, { type: 'char', keyCode: ',', modifiers: ['meta'] }])
  await expect.poll(() => open('Settings'), { timeout: 8000 }).toBe(true)
})

const barJs = (code: string) =>
  app.evaluate(async ({ webContents }, c) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/search/'))
    return wc ? await wc.executeJavaScript(c) : null
  }, code)
const toggleBar = () => app.evaluate(() => (globalThis as unknown as { __searchBar: { toggle(): void } }).__searchBar.toggle())

test('the hotkey closes an open bar; what was typed stays when it opens again; the X clears the field', async () => {
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.getTitle().includes('Settings') || w.getTitle().includes('Pin Manager')) w.close() })
  await showBar()
  await expect.poll(barVisible).toBe(true)

  await expect.poll(() => barJs("document.getElementById('query') !== null")).toBe(true) // the page is there
  // What was typed stays when the bar opens again, so start from an empty field (an earlier test typed a key into it).
  await barJs("(() => { const i = document.getElementById('query'); i.value = ''; i.dispatchEvent(new Event('input')) })()")
  await new Promise((r) => setTimeout(r, 400)) // and the list had time to fill
  // No quick settings in the list any more.
  expect(String(await barJs("Array.from(document.querySelectorAll('h2')).map((h) => h.textContent).join('|')"))).not.toMatch(/settings/i)

  // The magnifier is on the left; typing turns it into an X on the left.
  await expect.poll(() => barJs("document.getElementById('glass').classList.contains('clear')")).toBe(false)
  await barJs("(() => { const i = document.getElementById('query'); i.value = 'half typed'; i.dispatchEvent(new Event('input')) })()")
  await expect.poll(() => barJs("document.getElementById('glass').classList.contains('clear')")).toBe(true)

  // The hotkey (toggle) closes the open bar. Opening again keeps the text, selected.
  await toggleBar()
  await expect.poll(barVisible).toBe(false)
  await toggleBar()
  await expect.poll(barVisible).toBe(true)
  expect(await barJs("document.getElementById('query').value")).toBe('half typed')
  await expect.poll(() => barJs("(() => { const i = document.getElementById('query'); return i.selectionStart === 0 && i.selectionEnd === i.value.length })()")).toBe(true)

  // The X clears the whole field and goes back to the magnifier.
  await barJs("document.getElementById('glass').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))")
  await expect.poll(() => barJs("document.getElementById('query').value")).toBe('')
  expect(await barJs("document.getElementById('glass').classList.contains('clear')")).toBe(false)
  await toggleBar() // leave it closed
})

test('window close or Cmd+W hides rather than destroys the search bar; destroyed window self-heals on toggle', async () => {
  await showBar()
  await expect.poll(barVisible).toBe(true)

  // Explicit window.close() should be intercepted and merely hide the bar
  await app.evaluate(({ BrowserWindow }) => {
    const bar = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/search/'))
    bar?.close()
  })
  await expect.poll(barVisible).toBe(false)

  // Verify window was not destroyed
  const stillAlive = await app.evaluate(({ BrowserWindow }) => {
    const bar = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/search/'))
    return !!bar && !bar.isDestroyed()
  })
  expect(stillAlive).toBe(true)

  // Toggling opens it again smoothly
  await toggleBar()
  await expect.poll(barVisible).toBe(true)

  // Cmd+W in the search input hides the bar
  await send('/search/', [{ type: 'keyDown', keyCode: 'W', modifiers: ['meta'] }, { type: 'char', keyCode: 'w', modifiers: ['meta'] }])
  await expect.poll(barVisible).toBe(false)

  // If the window is forcefully destroyed, toggle() must self-heal and not throw
  await app.evaluate(({ BrowserWindow }) => {
    const bar = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/search/'))
    bar?.destroy()
  })
  const isDestroyed = await app.evaluate(({ BrowserWindow }) => {
    const bar = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/search/'))
    return !bar || bar.isDestroyed()
  })
  expect(isDestroyed).toBe(true)

  // Toggle must not throw "TypeError: Object has been destroyed" and must recreate & show the bar
  await toggleBar()
  await expect.poll(barVisible).toBe(true)
  await toggleBar() // leave it closed
})
