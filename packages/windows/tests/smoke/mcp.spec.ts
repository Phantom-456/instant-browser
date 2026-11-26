import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication

test.afterAll(async () => { await app?.close() })

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer()
  s.listen(0, '127.0.0.1', () => { const port = (s.address() as { port: number }).port; s.close(() => resolve(port)) })
})

test('the agent server answers on 127.0.0.1 with a key, lists only the tools Windows has (the switched-off groups are left out), and refuses without a key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ib-mcp-'))
  const port = await freePort()
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ mcpEnabled: true, mcpPort: port }))
  app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`] })
  const url = `http://127.0.0.1:${port}/mcp`
  await expect.poll(async () => { try { return (await fetch(url, { method: 'POST' })).status } catch { return 0 } }, { timeout: 20_000 }).toBe(401)
  const agents = JSON.parse(readFileSync(join(dir, 'mcp-agents.json'), 'utf8')) as Array<{ key: string }>
  const rpc = (method: string, params: object = {}, key = agents[0]!.key) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  expect((await rpc('initialize', { protocolVersion: '2025-06-18' }, 'wrong')).status).toBe(401)
  expect((await rpc('initialize', { protocolVersion: '2025-06-18' })).status).toBe(200)
  const list = (await (await rpc('tools/list')).json()) as { result: { tools: Array<{ name: string }> } }
  const names = list.result.tools.map((t) => t.name)
  expect(names).toContain('list_history')
  expect(names).toContain('open_window')
  expect(names).toContain('create_bookmark_folder')
  expect(names).toContain('get_settings') // reading settings is always on; changing them is not
  for (const gone of ['list_bookmarks', 'list_browser_bookmarks', 'list_browser_tabs', 'read_page', 'screenshot', 'set_setting', 'click', 'type', 'scroll']) expect(names).not.toContain(gone)
})
