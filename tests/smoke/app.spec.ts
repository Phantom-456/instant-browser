import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

let server: Server
let base: string
let lastGpc: string | undefined
let app: ElectronApplication

test.beforeAll(async () => {
  server = createServer((req, res) => {
    lastGpc = req.headers['sec-gpc'] as string | undefined
    res.setHeader('content-type', 'text/html')
    if (req.url === '/popup') res.end('<title>Popup page</title><h1>popup</h1>')
    else res.end('<title>Start page</title><a id="open" href="/popup" target="_blank">open</a>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await app?.close()
  server.close()
})

const windowCount = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible()).length)

test('a URL on the command line opens a mini window, and a popup opens a second one', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'ib-smoke-'))
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, `${base}/`] })

  await expect.poll(windowCount).toBe(1)

  const titles = () =>
    app.evaluate(({ webContents }) => webContents.getAllWebContents().map((wc) => wc.getTitle()))
  await expect.poll(titles).toContain('Start page')

  await app.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((wc) => wc.getTitle() === 'Start page')
    await page?.executeJavaScript("document.getElementById('open').click()", true)
  })

  await expect.poll(windowCount).toBe(2)
  await expect.poll(titles).toContain('Popup page')
})

test('pages get the privacy header, and an http address on the internet is tried as https', async () => {
  const bar = app.windows().find((w) => w.url().includes('/search/'))
  expect(bar).toBeTruthy()
  expect(lastGpc).toBe('1')

  // example.com answers on https. The mini window must end on the https address.
  await bar!.evaluate(() => (window as unknown as { instantSearch: { submit(t: string): void } }).instantSearch.submit('http://example.com'))
  const urls = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((wc) => wc.getURL()))
  await expect.poll(urls, { timeout: 15_000 }).toContain('https://example.com/')
})

test('Cmd+, in a mini window opens settings, and changes are applied and saved', async () => {
  // The first test left mini windows open. Send Cmd+, to the first web page.
  await app.evaluate(({ webContents }) => {
    const page = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http'))
    page?.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
  })
  const settingsPage = async () => {
    for (const w of app.windows()) if ((await w.title()) === 'Instant Browser Settings') return w
    return null
  }
  await expect.poll(async () => (await settingsPage()) !== null, { timeout: 10_000 }).toBe(true)
  const page = (await settingsPage())!

  type Api = { get(): Promise<{ hotkeyOk: boolean; settings: { hotkey: string; searchTemplate: string } }>; update(p: object): Promise<{ hotkeyOk: boolean }> }
  const before = await page.evaluate(() => (window as unknown as { instantSettings: Api }).instantSettings.get())
  expect(before.hotkeyOk).toBe(true)

  const after = await page.evaluate(() =>
    (window as unknown as { instantSettings: Api }).instantSettings.update({
      hotkey: 'Alt+Shift+Space',
      searchTemplate: 'https://duckduckgo.com/?q=%s'
    })
  )
  expect(after.hotkeyOk).toBe(true)
  const registered = (key: string) => app.evaluate(({ globalShortcut }, k) => globalShortcut.isRegistered(k), key)
  expect(await registered('Alt+Shift+Space')).toBe(true)
  expect(await registered('Control+Alt+Space')).toBe(false)

  // The page shows the sections.
  await expect(page.locator('nav button')).toHaveCount(7)
})

test('hotkey recorder: Change, press new keys, it is saved and active', async () => {
  const find = async () => {
    for (const w of app.windows()) if ((await w.title()) === 'Instant Browser Settings') return w
    return null
  }
  const page = (await find())!
  type Api = { action(a: object): Promise<unknown> }
  await page.evaluate(() => (window as unknown as { instantSettings: Api }).instantSettings.action({ type: 'hotkey-record-start' }))
  // While recording, the old hotkey is off.
  expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+Shift+Space'))).toBe(false)

  // Press Command+Option+B (Control+Alt+B on other systems).
  const mac = process.platform === 'darwin'
  await app.evaluate(({ webContents }, isMac) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/settings/'))
    wc?.sendInputEvent({ type: 'keyDown', keyCode: 'B', modifiers: isMac ? ['meta', 'alt'] : ['control', 'alt'] })
  }, mac)
  const expected = mac ? 'Alt+Command+B' : 'Control+Alt+B'
  await expect
    .poll(() => app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), expected), { timeout: 5000 })
    .toBe(true)
  expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Alt+Shift+Space'))).toBe(false)
})

test('mini windows stay on their desktop, and only the follow button makes one follow', async () => {
  test.skip(process.platform !== 'darwin', 'following desktops is a Mac feature for now')
  const flags = () =>
    app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()
        .filter((w) => w.isVisible() && w.contentView.children.length === 2) // visible mini windows (the hidden spare is left out)
        .map((w) => w.isVisibleOnAllWorkspaces())
    )
  const before = await flags()
  expect(before.length).toBeGreaterThanOrEqual(2)
  expect(before.every((f) => f === false)).toBe(true)

  // Press "follow" in the toolbar of the first visible mini window.
  await app.evaluate(({ BaseWindow }) => {
    const mini = BaseWindow.getAllWindows().find((w) => w.isVisible() && w.contentView.children.length === 2)
    const toolbar = mini?.contentView.children[1] as unknown as { webContents: Electron.WebContents }
    return toolbar.webContents.executeJavaScript("document.getElementById('follow').click()")
  })
  await expect.poll(async () => (await flags()).filter(Boolean).length).toBe(1)
})

test('search bar: suggestions come from the search engine, and the bar grows to show them', async () => {
  const bar = app.windows().find((w) => w.url().includes('/search/'))!
  type Api = { suggest(t: string): Promise<string[]>; resize(h: number): void }
  // Settings were changed in an earlier test; put Google back so the test does not depend on that.
  const settingsPage = app.windows().find((w) => w.url().includes('/settings/'))!
  await settingsPage.evaluate(() =>
    (window as unknown as { instantSettings: { update(p: object): Promise<unknown> } }).instantSettings.update({
      searchTemplate: 'https://www.google.com/search?q=%s',
      showSuggestions: true
    })
  )
  const list = await bar.evaluate(() => (window as unknown as { instantSearch: Api }).instantSearch.suggest('define ent'))
  expect(list.length).toBeGreaterThan(0)
  expect(list.length).toBeLessThanOrEqual(7)
  expect(list.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)

  // Turned off: nothing is asked and nothing comes back.
  await settingsPage.evaluate(() =>
    (window as unknown as { instantSettings: { update(p: object): Promise<unknown> } }).instantSettings.update({ showSuggestions: false })
  )
  expect(await bar.evaluate(() => (window as unknown as { instantSearch: Api }).instantSearch.suggest('define ent'))).toEqual([])

  // The bar window can grow and shrink.
  const height = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Instant Browser Search')!.getBounds().height)
  await bar.evaluate(() => (window as unknown as { instantSearch: Api }).instantSearch.resize(340))
  await expect.poll(height).toBe(340)
  await bar.evaluate(() => (window as unknown as { instantSearch: Api }).instantSearch.resize(60))
  await expect.poll(height).toBe(60)
})

test('light and dark follow the system', async () => {
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system')
  // Our pages read the system setting: forcing the theme in the app changes what the page sees.
  const toolbar = () => app.windows().find((w) => w.url().includes('/toolbar/'))!
  // Playwright forces "light" on the pages it controls. Remove that, so the page sees the real system setting.
  await toolbar().emulateMedia({ colorScheme: null })
  const scheme = () => toolbar().evaluate(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark' })
  await expect.poll(scheme).toBe('dark')
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light' })
  await expect.poll(scheme).toBe('light')
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system' })
})

test.describe('link router (Instant Browser is the default browser)', () => {
  const OPTION_COMMAND = String((1 << 19) | (1 << 20))

  async function startWith(mask: string, extraEnv: Record<string, string> = {}) {
    const logs: string[] = []
    const routed = await electron.launch({
      args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-router-'))}`, `${base}/`],
      env: { ...process.env, INSTANT_TEST: '1', INSTANT_TEST_MASK: mask, ...extraEnv } as Record<string, string>
    })
    routed.process().stdout?.on('data', (d) => logs.push(String(d)))
    await routed.firstWindow()
    return { routed, logs }
  }
  const miniCount = (a: ElectronApplication) =>
    a.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible() && w.contentView.children.length === 2).length)

  test('no keys held: the link goes to the main browser, no mini window', async () => {
    const { routed, logs } = await startWith('0')
    try {
      await expect.poll(() => logs.join(''), { timeout: 10_000 }).toContain(`[instant] sent`)
      expect(logs.join('')).toContain(`${base}/`)
      expect(await miniCount(routed)).toBe(0)
    } finally {
      await routed.close()
    }
  })

  test('Option+Command held: the link opens in a mini window and is not sent', async () => {
    const { routed, logs } = await startWith(OPTION_COMMAND)
    try {
      await expect.poll(() => miniCount(routed), { timeout: 10_000 }).toBe(1)
      expect(logs.join('')).not.toContain('[instant] sent')
    } finally {
      await routed.close()
    }
  })

  test('not the default browser: the link opens in a mini window whatever keys are held', async () => {
    const { routed, logs } = await startWith('0', { INSTANT_TEST_DEFAULT: '0' })
    try {
      await expect.poll(() => miniCount(routed), { timeout: 10_000 }).toBe(1)
      expect(logs.join('')).not.toContain('[instant] sent')
    } finally {
      await routed.close()
    }
  })

  test('Dia profile: a link sent to Dia carries the chosen profile', async () => {
    test.skip(process.platform !== 'darwin', 'Dia profiles are a Mac feature')
    const userData = mkdtempSync(join(tmpdir(), 'ib-dia-'))
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ mainBrowserId: 'company.thebrowser.dia', diaProfile: 'Hack' }))
    const logs: string[] = []
    const routed = await electron.launch({
      args: ['.', `--user-data-dir=${userData}`, `${base}/`],
      env: { ...process.env, INSTANT_TEST: '1', INSTANT_TEST_MASK: '0' } as Record<string, string>
    })
    routed.process().stdout?.on('data', (d) => logs.push(String(d)))
    try {
      await routed.firstWindow()
      await expect.poll(() => logs.join(''), { timeout: 10_000 }).toContain('[instant] sent company.thebrowser.dia')
      expect(logs.join('')).toMatch(/\[instant\] sent company\.thebrowser\.dia \S+ Hack/)
    } finally {
      await routed.close()
    }
  })
})

test.describe('search bar history and bubbles', () => {
  const CHROMIUM_EPOCH = 11_644_473_600_000n
  const chromeTime = (msAgo: number) => (BigInt(Date.now() - msAgo) + CHROMIUM_EPOCH) * 1000n

  /** Two made-up browsers (one Chromium, one Firefox). No real history is read in tests. */
  function makeFixtures() {
    const root = mkdtempSync(join(tmpdir(), 'ib-hist-'))
    mkdirSync(join(root, 'dia', 'Default'), { recursive: true })
    mkdirSync(join(root, 'chrome', 'Default'), { recursive: true })
    mkdirSync(join(root, 'ff', 'p1'), { recursive: true })
    const chromium = (dir: string, rows: Array<[string, string, number, number]>) => {
      const db = new DatabaseSync(join(dir, 'History'))
      db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER)')
      const add = db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, 0)')
      for (const [url, title, visits, minutesAgo] of rows) add.run(url, title, visits, chromeTime(minutesAgo * 60_000))
      db.close()
    }
    chromium(join(root, 'dia', 'Default'), [
      ['https://www.google.com/search?q=aws+lambda+cold+start', 'x', 3, 20],
      ['https://www.google.com/search?q=rust+borrow+checker', 'x', 1, 90],
      ['https://aws.amazon.com/lambda/', 'AWS Lambda', 6, 25]
    ])
    chromium(join(root, 'chrome', 'Default'), [
      ['https://www.google.com/search?q=aws+lambda+cold+start', 'x', 1, 600],
      ['https://news.ycombinator.com/', 'Hacker News', 9, 700]
    ])
    const ff = new DatabaseSync(join(root, 'ff', 'p1', 'places.sqlite'))
    ff.exec('CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER)')
    ff.prepare('INSERT INTO moz_places (url, title, visit_count, last_visit_date) VALUES (?, ?, ?, ?)').run(
      'https://duckduckgo.com/?q=aws+pricing+calculator', 'x', 2, (Date.now() - 2000 * 60_000) * 1000
    )
    ff.close()
    return JSON.stringify([
      { name: 'Dia', kind: 'chromium', dir: join(root, 'dia') },
      { name: 'Google Chrome', kind: 'chromium', dir: join(root, 'chrome') },
      { name: 'Firefox', kind: 'firefox', dir: join(root, 'ff') }
    ])
  }

  async function launchWithHistory(settings: object = {}) {
    const userData = mkdtempSync(join(tmpdir(), 'ib-bar-'))
    writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
    const bar = await electron.launch({
      args: ['.', `--user-data-dir=${userData}`, 'http://127.0.0.1:9/'],
      env: { ...process.env, INSTANT_TEST: '1', INSTANT_TEST_MASK: '0', INSTANT_TEST_DEFAULT: '0', INSTANT_TEST_HISTORY: makeFixtures() } as Record<string, string>
    })
    await bar.firstWindow()
    // The window list can lag behind the launch, so wait until the search bar page is there.
    const page = async () => {
      for (let i = 0; i < 100; i++) {
        const found = bar.windows().find((w) => w.url().includes('/search/'))
        if (found) return found
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error('search bar page not found')
    }
    type Q = { query(t: string): Promise<{ settings: Array<{ label: string }>; searches: Array<{ term: string; sources: string[] }>; pages: Array<{ title: string; sources: string[] }> }> }
    const query = async (text: string) => (await page()).evaluate((t) => (window as unknown as { instantSearch: Q }).instantSearch.query(t), text)
    return { bar, page, query }
  }

  test('nothing typed: recent searches and pages from all browsers, and settings bubbles', async () => {
    const { bar, query } = await launchWithHistory()
    try {
      // The history is built a moment after start.
      await expect.poll(async () => (await query('')).searches.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3)
      const empty = await query('')
      expect(empty.settings.map((b) => b.label)).toEqual(['Settings', 'Hotkey', 'Search engine', 'Privacy'])
      // The same search in two browsers is one entry that names both.
      const aws = empty.searches.find((s) => s.term === 'aws lambda cold start')!
      expect([...aws.sources].sort()).toEqual(['Dia', 'Google Chrome'])
      expect(empty.searches.map((s) => s.term)).toContain('aws pricing calculator') // from Firefox
      // Most recent first.
      expect(empty.searches[0]?.term).toBe('aws lambda cold start')
      expect(empty.pages.map((p) => p.title)).toContain('Hacker News')
    } finally {
      await bar.close()
    }
  })

  test('typing: matching history, and matching settings bubbles', async () => {
    const { bar, query } = await launchWithHistory()
    try {
      await expect.poll(async () => (await query('aws')).searches.length, { timeout: 10_000 }).toBe(2)
      const typed = await query('aws')
      expect(typed.pages.map((p) => p.title)).toEqual(['AWS Lambda'])
      expect((await query('hot')).settings.map((b) => b.label)).toEqual(['Hotkey'])
      expect((await query('zzzz')).searches).toEqual([])
    } finally {
      await bar.close()
    }
  })

  test('history can be turned off', async () => {
    const { bar, query } = await launchWithHistory({ showHistory: false })
    try {
      await new Promise((r) => setTimeout(r, 3000))
      const empty = await query('')
      expect(empty.searches).toEqual([])
      expect(empty.pages).toEqual([])
      expect(empty.settings.length).toBe(4) // the settings bubbles stay
    } finally {
      await bar.close()
    }
  })

  test('one browser can be turned off by name', async () => {
    const { bar, query } = await launchWithHistory({ historyOff: ['Firefox'] })
    try {
      await expect.poll(async () => (await query('')).searches.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
      expect((await query('')).searches.map((s) => s.term)).not.toContain('aws pricing calculator')
    } finally {
      await bar.close()
    }
  })

  test('a settings bubble opens that section of the settings window', async () => {
    const { bar, page } = await launchWithHistory()
    try {
      await (await page()).evaluate(() => (window as unknown as { instantSearch: { openSettings(s: string): void } }).instantSearch.openSettings('Search engine'))
      const settingsTitle = async () => {
        for (const w of bar.windows()) if ((await w.title()) === 'Instant Browser Settings') return w
        return null
      }
      await expect.poll(async () => (await settingsTitle()) !== null, { timeout: 10_000 }).toBe(true)
      const win = (await settingsTitle())!
      await expect(win.locator('h1')).toHaveText('Search engine')
      // A bubble can change the section of a window that is already open.
      await (await page()).evaluate(() => (window as unknown as { instantSearch: { openSettings(s: string): void } }).instantSearch.openSettings('Downloads'))
      await expect(win.locator('h1')).toHaveText('Downloads')
      // An unknown section is ignored.
      await (await page()).evaluate(() => (window as unknown as { instantSearch: { openSettings(s: string): void } }).instantSearch.openSettings('Not a section'))
      await new Promise((r) => setTimeout(r, 300))
      await expect(win.locator('h1')).toHaveText('Downloads')
    } finally {
      await bar.close()
    }
  })
})

test.describe('speed: a ready window, instant feedback, history in another process', () => {
  const miniInfo = (a: ElectronApplication) =>
    a.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()
        .filter((w) => w.contentView.children.length === 2)
        .map((w) => ({ id: w.id, visible: w.isVisible() }))
    )

  async function launchPlain(settings: object = {}, env: Record<string, string> = {}) {
    const userData = mkdtempSync(join(tmpdir(), 'ib-speed-'))
    writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
    const logs: string[] = []
    const a = await electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      env: { ...process.env, INSTANT_TEST: '1', INSTANT_TEST_DEFAULT: '0', ...env } as Record<string, string>
    })
    a.process().stdout?.on('data', (d) => logs.push(String(d)))
    await a.firstWindow()
    return { a, logs, userData }
  }
  const searchPage = async (a: ElectronApplication) => {
    for (let i = 0; i < 100; i++) {
      const found = a.windows().find((w) => w.url().includes('/search/'))
      if (found) return found
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('search bar page not found')
  }

  test('a hidden window is made ready at start, and the next window uses it', async () => {
    const { a } = await launchPlain()
    try {
      await expect.poll(async () => (await miniInfo(a)).length, { timeout: 8000 }).toBe(1)
      const [spare] = await miniInfo(a)
      expect(spare!.visible).toBe(false) // nobody sees it
      const bar = await searchPage(a)
      await bar.evaluate(() => (window as unknown as { instantSearch: { submit(t: string): void } }).instantSearch.submit('http://127.0.0.1:9/'))
      await expect.poll(async () => (await miniInfo(a)).filter((w) => w.visible).length, { timeout: 5000 }).toBe(1)
      const shown = (await miniInfo(a)).find((w) => w.visible)!
      expect(shown.id).toBe(spare!.id) // the ready window was used
      // A new one is made ready a moment later.
      await expect.poll(async () => (await miniInfo(a)).filter((w) => !w.visible).length, { timeout: 8000 }).toBe(1)
    } finally {
      await a.close()
    }
  })

  test('the setting "keep a window ready" can be turned off', async () => {
    const { a } = await launchPlain({ warmWindow: false })
    try {
      await new Promise((r) => setTimeout(r, 3000))
      expect(await miniInfo(a)).toEqual([])
    } finally {
      await a.close()
    }
  })

  test('feedback at once: the window shows the address and a loader before a slow page answers', async () => {
    const slow = createServer((_req, res) => {
      setTimeout(() => { res.setHeader('content-type', 'text/html'); res.end('<title>Slow</title>done') }, 2500)
    })
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(slow.address() as AddressInfo).port}/slow/page`
    const { a } = await launchPlain()
    try {
      await expect.poll(async () => (await miniInfo(a)).length, { timeout: 8000 }).toBe(1)
      const bar = await searchPage(a)
      const t0 = Date.now()
      await bar.evaluate((u) => (window as unknown as { instantSearch: { submit(t: string): void } }).instantSearch.submit(u), url)
      const toolbarState = () =>
        a.evaluate(async ({ BaseWindow }) => {
          const mini = BaseWindow.getAllWindows().find((w) => w.isVisible() && w.contentView.children.length === 2)
          if (!mini) return null
          const toolbar = mini.contentView.children[1] as unknown as { webContents: Electron.WebContents }
          return toolbar.webContents.executeJavaScript(
            `({ label: document.getElementById('url').value, spinning: !document.getElementById('spin').hidden, progress: !document.getElementById('progress').hidden })`
          ) as Promise<{ label: string; spinning: boolean; progress: boolean }>
        })
      await expect.poll(toolbarState, { timeout: 3000 }).toMatchObject({ label: '127.0.0.1:' + new URL(url).port + '/slow/page', spinning: true, progress: true })
      expect(Date.now() - t0).toBeLessThan(2000) // long before the page (2.5 s) has answered
      // When the page is done the loader goes away.
      await expect.poll(toolbarState, { timeout: 8000 }).toMatchObject({ spinning: false, progress: false })
    } finally {
      await a.close()
      slow.close()
    }
  })

  /** Chromium-style history files with made-up rows. */
  function makeHistory(root: string, rows: number): { sources: string; file: string } {
    mkdirSync(join(root, 'dia', 'Default'), { recursive: true })
    const file = join(root, 'dia', 'Default', 'History')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER)')
    const add = db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, 0)')
    db.exec('BEGIN')
    for (let i = 0; i < rows; i++) {
      const search = i % 5 === 0
      add.run(
        search ? `https://www.google.com/search?q=made+up+topic+${i}` : `https://site${i}.example.com/page/${i}`,
        search ? 'x' : `Page number ${i} with a longer made up title to give the file some size`,
        1 + (i % 7),
        (BigInt(Date.now() - i * 1000) + 11_644_473_600_000n) * 1000n
      )
    }
    db.exec('COMMIT')
    db.close()
    return { sources: JSON.stringify([{ name: 'Dia', kind: 'chromium', dir: join(root, 'dia') }]), file }
  }

  test('the history is read in another process: the main thread stays free, and a cache is saved', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ib-big-'))
    const { sources } = makeHistory(root, 120_000)
    const { a, logs, userData } = await launchPlain({}, { INSTANT_PERF: '1', INSTANT_TEST_HISTORY: sources })
    try {
      await expect.poll(() => logs.join(''), { timeout: 20_000 }).toContain('fresh data ready')
      const text = logs.join('')
      const blocked = [...text.matchAll(/main thread blocked (\d+)ms/g)].map((m) => Number(m[1]))
      // Starting the other process may cost a little. Reading 120,000 rows in the main thread would cost seconds.
      expect(Math.max(0, ...blocked)).toBeLessThan(400)
      const cache = join(userData, 'history-cache.json')
      expect(statSync(cache).size).toBeGreaterThan(1000)
      expect(statSync(cache).mode & 0o777).toBe(0o600) // only this user can read it (not checked on Windows)
    } finally {
      await a.close()
    }
  })

  test('the bar is told when the history files changed, and it shows the new data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ib-chg-'))
    const { sources, file } = makeHistory(root, 50)
    const { a } = await launchPlain({}, { INSTANT_TEST_HISTORY: sources, INSTANT_TEST_CHECK_MS: '0' })
    try {
      const bar = await searchPage(a)
      type Api = { query(t: string): Promise<{ searches: Array<{ term: string }> }>; onHistoryChanged(cb: () => void): void }
      await bar.evaluate(() => {
        const w = window as unknown as { instantSearch: Api; __changed: number }
        w.__changed = 0
        w.instantSearch.onHistoryChanged(() => { w.__changed++ })
      })
      const terms = () => bar.evaluate(async () => (await (window as unknown as { instantSearch: Api }).instantSearch.query('')).searches.map((s) => s.term))
      await expect.poll(terms, { timeout: 10_000 }).toContain('made up topic 0')

      // A browser writes a new search. The bar opens (here: shown), sees the file changed, and reads it again.
      const db = new DatabaseSync(file)
      db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, 1, ?, 0)').run(
        'https://www.google.com/search?q=brand+new+search+words', 'x', (BigInt(Date.now() + 5000) + 11_644_473_600_000n) * 1000n
      )
      db.close()
      await a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Instant Browser Search')!.showInactive())
      await expect.poll(terms, { timeout: 10_000 }).toContain('brand new search words')
      // The bar was visible, so it was told.
      expect(await bar.evaluate(() => (window as unknown as { __changed: number }).__changed)).toBeGreaterThan(0)
    } finally {
      await a.close()
    }
  })
})

test('quitting while the history is being read gives no error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ib-quit-'))
  mkdirSync(join(root, 'dia', 'Default'), { recursive: true })
  const db = new DatabaseSync(join(root, 'dia', 'Default', 'History'))
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER)')
  const add = db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, 1, ?, 0)')
  db.exec('BEGIN')
  for (let i = 0; i < 150_000; i++) add.run(`https://site${i}.example.com/p`, `Title ${i}`, (BigInt(Date.now() - i * 1000) + 11_644_473_600_000n) * 1000n)
  db.exec('COMMIT')
  db.close()
  const messages: string[] = []
  const quitting = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-quit-ud-'))}`],
    env: {
      ...process.env, INSTANT_TEST: '1', INSTANT_PERF: '1', INSTANT_TEST_DEFAULT: '0',
      INSTANT_TEST_HISTORY: JSON.stringify([{ name: 'Dia', kind: 'chromium', dir: join(root, 'dia') }])
    } as Record<string, string>
  })
  quitting.process().stdout?.on('data', (d) => messages.push(String(d)))
  quitting.process().stderr?.on('data', (d) => messages.push(String(d)))
  await expect.poll(() => messages.join(''), { timeout: 15_000 }).toContain('scan starts')
  await quitting.close() // quit while the other process is still reading
  await new Promise((r) => setTimeout(r, 1500))
  expect(messages.join('')).not.toMatch(/Uncaught Exception|Object has been destroyed/)
})
