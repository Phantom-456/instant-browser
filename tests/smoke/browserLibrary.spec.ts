import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const apps: ElectronApplication[] = []
test.afterAll(async () => { for (const a of apps) await a.close().catch(() => {}) })

const bookmarkFile = (urls: string[]) =>
  JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: urls.map((u, i) => ({ type: 'url', name: `Page ${i}`, url: u, date_added: '13300000000000000' })) } } })

function fixture(urls: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'ib-browsers-'))
  mkdirSync(join(root, 'Chrome', 'Default'), { recursive: true })
  writeFileSync(join(root, 'Chrome', 'Default', 'Bookmarks'), bookmarkFile(urls))
  return { root, file: join(root, 'Chrome', 'Default', 'Bookmarks'), sources: JSON.stringify([{ name: 'Test Chrome', kind: 'chromium', dir: join(root, 'Chrome') }]) }
}

async function launch(urls: string[], settings: object = {}, tabs: Record<string, string> = {}) {
  const f = fixture(urls)
  const userData = mkdtempSync(join(tmpdir(), 'ib-lib-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, INSTANT_TEST: '1', INSTANT_TEST_MASK: '0', INSTANT_TEST_DEFAULT: '0', INSTANT_TEST_PINS: '1', INSTANT_TEST_NO_POLL: '1', INSTANT_TEST_WATCH: '1', INSTANT_TEST_TABS_MS: '300', INSTANT_TEST_HISTORY: f.sources, INSTANT_TEST_TABS: JSON.stringify(tabs) } as Record<string, string>
  })
  apps.push(app)
  await expect.poll(() => app.evaluate(() => !!(globalThis as Record<string, unknown>).__manager), { timeout: 15_000 }).toBe(true)
  await app.evaluate(() => (globalThis as unknown as { __manager: { open(): void } }).__manager.open())
  return { app, userData, ...f }
}

const managerText = (a: ElectronApplication) =>
  a.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/manager/'))
    return wc ? ((await wc.executeJavaScript('document.body.innerText').catch(() => '')) as string).toLowerCase() : ''
  })

test('bookmarks of other browsers are merged, copied to our own folder, and follow a change in the browser file', async () => {
  const { app, userData, file } = await launch(['https://one.example.com/', 'https://two.example.com/#x'])
  await expect.poll(() => managerText(app), { timeout: 15_000 }).toContain('bookmarks from your browsers (2)')
  expect(existsSync(join(userData, 'browsers', 'bookmarks-merged.json'))).toBe(true)
  expect(await managerText(app)).not.toContain('open tabs in your browsers') // the permission switch is off by default
  // The browser saves a new bookmark: Talaria notices by itself.
  writeFileSync(file, bookmarkFile(['https://one.example.com/', 'https://two.example.com/', 'https://three.example.com/']))
  await expect.poll(() => managerText(app), { timeout: 20_000 }).toContain('bookmarks from your browsers (3)')
})

test('open tabs are listed only when the switch is on, with a first-seen time; Settings explains each browser', async () => {
  const tab = '4\t7\thttps://tab.example.com/\tA live tab\n'
  const { app } = await launch([], { liveTabs: true }, { 'Google Chrome': tab })
  await expect.poll(() => managerText(app), { timeout: 15_000 }).toContain('open tabs in your browsers (1)')
  const text = await managerText(app)
  expect(text).toContain('a live tab')
  expect(text).toContain('first seen')
  await expect.poll(() => app.evaluate(async ({ webContents }) => {
    const page = () => webContents.getAllWebContents().find((w) => w.getURL().includes('/settings/'))
    if (!page()) {
      const bar = webContents.getAllWebContents().find((w) => w.getURL().includes('/search/'))
      await bar?.executeJavaScript("window.instantSearch?.openSettings('Your browsers')").catch(() => {})
    }
    const wc = page()
    return wc ? ((await wc.executeJavaScript('document.body.innerText').catch(() => '')) as string) : ''
  }), { timeout: 15_000, intervals: [300] }).toContain('List open tabs')
})
