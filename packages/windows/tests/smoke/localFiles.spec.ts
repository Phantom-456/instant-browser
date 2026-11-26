import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('local consent, assets, Markdown CSP, per-open isolation and revocation', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ib-local-smoke-')))
  const root = join(dir, 'page'); mkdirSync(root)
  const html = join(root, 'index.html')
  const md = join(root, 'notes.md')
  writeFileSync(html, '<title>Local HTML</title><script src="./app.js"></script><h1>Local</h1>')
  writeFileSync(join(root, 'app.js'), 'document.documentElement.dataset.script="yes"')
  writeFileSync(md, '# Notes\n\n**Readable**\n<script>document.title="Unsafe"</script><img src="missing.png" onerror="document.title=\'Unsafe\'">')
  writeFileSync(join(dir, 'secret.txt'), 'secret')
  const app = await electron.launch({ args: ['.', `--user-data-dir=${join(dir, 'userdata')}`], env: { ...process.env, INSTANT_TEST_PINS: '1' } })
  try {
    await app.firstWindow()
    // The first window may be a bubble, and the bar's page reports its /search/ address only once it has loaded:
    // wait for the bar's page itself (same race as the Mac fix 7b5796a; Windows CI on PR #69 found no bar here).
    await expect.poll(() => app.evaluate(async ({ webContents }) => {
      const bar = webContents.getAllWebContents().find((wc) => wc.getURL().includes('/search/'))
      return !!bar && !bar.isLoading() && (await bar.executeJavaScript('typeof window.instantSearch?.submit')) === 'function'
    }), { timeout: 15_000 }).toBe(true)
    await app.evaluate(({ dialog }) => {
      const state = globalThis as any
      state.localPrompts = []; state.localResponse = 0
      dialog.showMessageBox = (async (...args: any[]) => {
        state.localPrompts.push(args.at(-1))
        return { response: state.localResponse, checkboxChecked: false }
      }) as any
    })
    const submit = async (text: string) => app.evaluate(async ({ webContents }, text) => {
      const bar = webContents.getAllWebContents().find((wc) => wc.getURL().includes('/search/'))!
      await bar.executeJavaScript(`window.instantSearch.submit(${JSON.stringify(text)})`)
    }, text)
    const count = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((wc) => wc.getURL().startsWith('instant-local:')).length)
    await submit(html)
    await expect.poll(() => app.evaluate(() => (globalThis as any).localPrompts.length)).toBe(1)
    expect(await count()).toBe(0)
    await app.evaluate(() => { (globalThis as any).localResponse = 1 })
    await submit(html)
    await expect.poll(count).toBe(1)
    const first = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('instant-local:'))!
      return { url: wc.getURL(), id: wc.id, script: await wc.executeJavaScript('document.documentElement.dataset.script'), sandbox: (wc as any).getLastWebPreferences().sandbox, node: (wc as any).getLastWebPreferences().nodeIntegration }
    })
    expect(first.script).toBe('yes'); expect(first.sandbox).toBe(true); expect(first.node).toBe(false)
    await submit(md)
    await expect.poll(count).toBe(2)
    const markdown = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/notes.md'))!
      return { body: await wc.executeJavaScript('document.body.innerHTML'), title: wc.getTitle(), csp: (await wc.session.fetch(wc.getURL())).headers.get('Content-Security-Policy') }
    })
    expect(markdown.body).toContain('<strong>Readable</strong>')
    expect(markdown.body).not.toMatch(/<script|onerror/)
    expect(markdown.title).toBe('Markdown')
    // Evaluate bypasses page CSP; the response header proves ordinary page scripts are blocked.
    expect(markdown.csp).toContain("script-src 'none'")
    await submit(html)
    await expect.poll(count).toBe(3)
    expect(await app.evaluate(() => (globalThis as any).localPrompts.length)).toBe(4)
    const result = await app.evaluate(async ({ webContents, BaseWindow }, first) => {
      const wc = webContents.fromId(first.id)!
      const isolated = wc.session
      const statuses = await wc.executeJavaScript(`Promise.all([fetch('/%2e%2e%2fsecret.txt').then(r=>r.status),fetch('/app.js').then(r=>r.status)])`)
      const owner = BaseWindow.getAllWindows().find((w) => w.contentView.children.some((v: any) => v.webContents?.id === wc.id))!
      owner.close()
      await new Promise((r) => setTimeout(r, 100))
      let revoked = false
      try { await isolated.fetch(first.url) } catch { revoked = true }
      return { statuses, revoked }
    }, first)
    expect(result.statuses).toEqual([403, 200]); expect(result.revoked).toBe(true)
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }) }
})
