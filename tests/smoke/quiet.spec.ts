import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// In quiet mode (the default for these tests) no window can be seen or clicked, and none takes the keyboard.
test('test windows are invisible, ignore the real mouse and never take focus', async () => {
  const site = createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>Quiet</title>') })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`
  const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-quiet-'))}`, url], env: { ...process.env, INSTANT_TEST_QUIET: '1' } })
  try {
    await expect.poll(() => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible()).length), { timeout: 15_000 }).toBeGreaterThan(0)
    const state = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible()).map((w) => ({ opacity: w.getOpacity(), focused: w.isFocused() })))
    expect(state.length).toBeGreaterThan(0)
    for (const w of state) {
      expect(w.opacity).toBe(0) // nobody can see it
      expect(w.focused).toBe(false) // it does not take the keyboard
    }
    // The window is still a real window: the page loaded and the program sees it as visible.
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'Quiet')), { timeout: 10_000 }).toBe(true)
  } finally {
    await app.close()
    site.close()
  }
})
