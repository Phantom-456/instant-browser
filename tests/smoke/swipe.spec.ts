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
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    if (req.url === '/wide') res.end('<title>Wide</title><div id="s" style="width:300px;overflow-x:auto"><div style="width:2000px">wide</div></div><h1>wide page</h1>')
    else res.end(`<title>Page ${req.url}</title><h1>${req.url}</h1>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-swipe-'))}`, `${base}/one`] })
})
test.afterAll(async () => {
  await app?.close()
  server.close()
})

const pageUrl = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().startsWith('http://127.0.0.1') && !w.getURL().includes('/toolbar/'))?.getURL() ?? '')
const load = (url: string) =>
  app.evaluate(async ({ webContents }, u) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('http://127.0.0.1'))!
    await wc.loadURL(u)
  }, url)
/** A two-finger swipe: many small sideways wheel events, 16 ms apart. `deltaX` is what the page sees (negative: fingers to the right). */
const swipe = (deltaX: number, steps = 12, y = 0, x = 200) =>
  app.evaluate(async ({ webContents }, a) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('http://127.0.0.1'))!
    for (let i = 0; i < a.steps; i++) {
      wc.sendInputEvent({ type: 'mouseWheel', x: a.x, y: 100 + a.y, deltaX: -a.deltaX, deltaY: 0, canScroll: true }) // the page sees the opposite sign: DOM deltaX = minus the input delta
      await new Promise((r) => setTimeout(r, 16))
    }
  }, { deltaX, steps, y, x })

test('a two-finger swipe goes back, and the other way goes forward', async () => {
  await expect.poll(pageUrl, { timeout: 10_000 }).toBe(`${base}/one`)
  await new Promise((r) => setTimeout(r, 600))
  await load(`${base}/two`)
  await expect.poll(pageUrl).toBe(`${base}/two`)
  await new Promise((r) => setTimeout(r, 400))

  await swipe(-30) // fingers to the right: back
  await expect.poll(pageUrl, { timeout: 8000 }).toBe(`${base}/one`)

  await new Promise((r) => setTimeout(r, 600)) // a pause ends the swipe
  await swipe(30) // fingers to the left: forward
  await expect.poll(pageUrl, { timeout: 8000 }).toBe(`${base}/two`)
})

test('a short swipe does nothing, and with no history a swipe does not go anywhere', async () => {
  await new Promise((r) => setTimeout(r, 600))
  await swipe(-5, 4) // far too short
  await new Promise((r) => setTimeout(r, 500))
  expect(await pageUrl()).toBe(`${base}/two`)
})

test('a page that can scroll sideways keeps the swipe for itself', async () => {
  await load(`${base}/wide`)
  await expect.poll(pageUrl).toBe(`${base}/wide`)
  await new Promise((r) => setTimeout(r, 600))
  // The pointer is over the sideways scroller, which can still scroll to the right: this swipe is the page's.
  await swipe(30, 14, -50, 50)
  await new Promise((r) => setTimeout(r, 500))
  expect(await pageUrl()).toBe(`${base}/wide`)
})
