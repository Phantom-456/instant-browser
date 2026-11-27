import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

// A page's full-screen request (YouTube's full-screen button) used to get no answer: the session denied the
// 'fullscreen' permission and the window could not go full screen, so the page waited for ever.

let server: Server
let url = ''
let app: ElectronApplication

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<title>Video</title><div id="v" style="width:200px;height:100px;background:#333"></div>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-fullscreen-'))}`, url] })
  await expect.poll(() => app.evaluate(({ webContents }, u) => webContents.getAllWebContents().some((w) => w.getURL() === u && !w.isLoading()), url), { timeout: 15_000 }).toBe(true)
})

test.afterAll(async () => {
  await app?.close()
  server.close()
})

type State = { pageFull: boolean; winFull: boolean; fullscreenable: boolean; win: { x: number; y: number; width: number; height: number }; content: { width: number; height: number }; page: { x: number; y: number; width: number; height: number }; toolbarVisible: boolean }
const state = () => app.evaluate(async ({ webContents, BaseWindow }, u): Promise<State> => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL() === u)!
  const win = BaseWindow.getAllWindows().find((w) => w.contentView.children.some((c) => (c as { webContents?: unknown }).webContents === wc))!
  const views = win.contentView.children as unknown as Array<{ webContents: Electron.WebContents; getBounds(): State['page']; getVisible(): boolean }>
  const page = views.find((v) => v.webContents === wc)!
  const toolbar = views.find((v) => v.webContents.getURL().includes('/toolbar/'))!
  const { width, height } = win.getContentBounds()
  return {
    pageFull: await wc.executeJavaScript('!!document.fullscreenElement'), winFull: win.isFullScreen(), fullscreenable: win.isFullScreenable(),
    win: win.getBounds(), content: { width, height }, page: page.getBounds(), toolbarVisible: toolbar.getVisible()
  }
}, url)

test('a video goes full screen and fills the screen; Esc brings back the old size', async () => {
  const before = await state()
  expect(before.fullscreenable).toBe(false) // the green button zooms the window, as before

  const answer = await app.evaluate(async ({ webContents }, u) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === u)!
    const asked = wc.executeJavaScript("document.getElementById('v').requestFullscreen().then(() => 'ok', (e) => 'refused: ' + e.message)", true)
    return Promise.race([asked, new Promise((resolve) => setTimeout(() => resolve('no answer'), 5000))])
  }, url)
  expect(answer).toBe('ok')

  await expect.poll(async () => (await state()).winFull, { timeout: 8000 }).toBe(true)
  // The page covers the whole window: no toolbar, no frame.
  await expect.poll(async () => { const s = await state(); return [s.page.x, s.page.y, s.page.width, s.page.height, s.toolbarVisible] }, { timeout: 8000 })
    .toEqual([0, 0, (await state()).content.width, (await state()).content.height, false])

  // Esc, as in any browser.
  await app.evaluate(({ webContents }, u) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === u)!
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  }, url)
  await expect.poll(async () => { const s = await state(); return [s.pageFull, s.winFull] }, { timeout: 8000 }).toEqual([false, false])
  await expect.poll(async () => (await state()).win, { timeout: 8000 }).toEqual(before.win) // the old size and place
  const after = await state()
  expect(after.page).toEqual(before.page) // toolbar and frame are back
  expect(after.toolbarVisible).toBe(true)
  expect(after.fullscreenable).toBe(false)
})

test('the page can also leave full screen itself (as with the exit button of YouTube)', async () => {
  const before = await state()
  await app.evaluate(({ webContents }, u) => { void webContents.getAllWebContents().find((w) => w.getURL() === u)!.executeJavaScript("document.getElementById('v').requestFullscreen()", true) }, url)
  await expect.poll(async () => (await state()).winFull, { timeout: 8000 }).toBe(true)
  await app.evaluate(({ webContents }, u) => { void webContents.getAllWebContents().find((w) => w.getURL() === u)!.executeJavaScript('document.exitFullscreen()', true) }, url)
  await expect.poll(async () => (await state()).winFull, { timeout: 8000 }).toBe(false)
  await expect.poll(async () => (await state()).win, { timeout: 8000 }).toEqual(before.win)
})
