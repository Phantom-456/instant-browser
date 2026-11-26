// Screenshots of every Windows UI surface, in light and dark mode, for design reviews.
// Run after `pnpm build`, from packages/windows, on a desktop (not a service session):
//   node tools/shots.mjs <outDir>
// Each picture is cut from a real screen capture, so it shows what the system draws too
// (Mica or acrylic, the window shadow, the corners and the caption buttons).
import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? 'shots')
mkdirSync(out, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let app

/** Capture the screen around the window whose title or URL matches, with a margin for the shadow. */
async function shot(name, match) {
  await wait(900)
  const png = await app.evaluate(async ({ BaseWindow, desktopCapturer, screen }, match) => {
    const urls = (w) => [w.webContents?.getURL?.() ?? '', ...w.contentView.children.map((v) => v.webContents?.getURL() ?? '')]
    // One match, or several: then the picture covers all matching windows (the bar and its bubbles).
    const matches = Array.isArray(match) ? match : [match]
    const hits = BaseWindow.getAllWindows().filter((w) => w.isVisible() && urls(w).some((u) => matches.some((m) => u.includes(m))))
    if (!hits.length) return null
    const all = hits.map((w) => w.getBounds())
    const left = Math.min(...all.map((r) => r.x)), top = Math.min(...all.map((r) => r.y))
    const b = { x: left, y: top, width: Math.max(...all.map((r) => r.x + r.width)) - left, height: Math.max(...all.map((r) => r.y + r.height)) - top }
    const display = screen.getDisplayMatching(b)
    const s = display.scaleFactor
    const size = { width: Math.round(display.bounds.width * s), height: Math.round(display.bounds.height * s) }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    const src = sources.find((x) => x.display_id === String(display.id)) ?? sources[0]
    const m = 28
    const x = Math.max(0, Math.round((b.x - display.bounds.x - m) * s))
    const y = Math.max(0, Math.round((b.y - display.bounds.y - m) * s))
    const crop = {
      x, y,
      width: Math.min(size.width - x, Math.round((b.width + m * 2) * s)),
      height: Math.min(size.height - y, Math.round((b.height + m * 2) * s))
    }
    return src.thumbnail.crop(crop).toPNG().toString('base64')
  }, match)
  if (!png) { console.log(`skip ${name}: no window matching ${match}`); return }
  writeFileSync(join(out, `${name}.png`), Buffer.from(png, 'base64'))
  console.log(`saved ${name}.png`)
}

const barPage = async () => {
  for (let i = 0; i < 50; i++) {
    const bar = app.windows().find((w) => w.url().includes('/search/'))
    if (bar) return bar
    await wait(200)
  }
  throw new Error('no search bar')
}

// One app per theme, so every page starts in that theme (as it would for a real user).
for (const theme of ['light', 'dark']) {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-shots-'))}`, 'https://example.com/'],
    // Not the default browser, so the address on the command line opens a mini window.
    env: { ...process.env, INSTANT_TEST: '1', INSTANT_TEST_PINS: '1', INSTANT_TEST_DEFAULT: '0' }
  })
  await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t }, theme)
  await wait(2500)
  // Reload every page so nothing keeps the theme it started with.
  await app.evaluate(({ webContents }) => { for (const wc of webContents.getAllWebContents()) wc.reload() })
  await wait(2500)
  await shot(`${theme}-mini`, 'example.com')
  // The address being edited: the focus style (accent underline on Windows).
  // Windows will not bring a window to the front for a test script, and a page in a background
  // window never shows :focus. Focus emulation makes the toolbar page act as the focused one.
  await app.evaluate(async ({ BaseWindow, webContents }) => {
    // The app keeps a hidden spare mini window ready, with its own toolbar: use the visible one.
    const win = BaseWindow.getAllWindows().find((w) => w.isVisible() && w.contentView.children.some((v) => v.webContents?.getURL().includes('example.com')))
    const tb = win?.contentView.children.map((v) => v.webContents).find((wc) => wc?.getURL().includes('/toolbar/'))
    if (!win || !tb) return
    win.focus()
    tb.focus()
    try { tb.debugger.attach('1.3') } catch {}
    await tb.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await tb.executeJavaScript("document.getElementById('url').focus(); document.getElementById('url').select()")
  })
  await shot(`${theme}-mini-address`, 'example.com')

  const bar = await barPage()
  await app.evaluate(() => globalThis.__searchBar.show())
  await wait(500)
  await shot(`${theme}-bar-empty`, '/search/')
  await bar.locator('#query').fill('exam')
  await wait(1200)
  await shot(`${theme}-bar-results`, ['/search/', '/bubble/'])

  // The always-on-top mini window would cover Settings and the Manager. Hiding it could quit the app, so make it see-through.
  const miniOpacity = (o) => app.evaluate(({ BaseWindow }, o) => {
    for (const w of BaseWindow.getAllWindows()) if (w.contentView.children.some((v) => v.webContents?.getURL().includes('example.com'))) w.setOpacity(o)
  }, o)
  await miniOpacity(0)
  // Older builds name the section 'General', newer ones 'general'.
  await bar.evaluate(() => { window.instantSearch.openSettings('general'); window.instantSearch.openSettings('General') })
  await wait(2500) // the settings page draws after it reads the settings
  await shot(`${theme}-settings`, '/settings/')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/settings/'))?.close())

  await bar.evaluate(() => window.instantSearch.openManager())
  await shot(`${theme}-manager`, '/manager/')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/manager/'))?.close())
  await miniOpacity(1)
  await app.close()
}
