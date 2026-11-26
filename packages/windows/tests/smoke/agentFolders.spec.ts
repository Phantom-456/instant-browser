import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication

test.afterAll(async () => { await app?.close() })

type Agent = { id: string; name: string }
type Agents = { createFolder(caller: Agent, name: string, allowDelete: boolean): { id: string }; add(caller: Agent, folderId: string, url: string, title: string): unknown; folders(): Array<{ items: unknown[]; allowDelete: boolean }> }
const managerJs = (code: string) =>
  app.evaluate(async ({ webContents }, c) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/manager/'))
    return wc ? await wc.executeJavaScript(c) : 'no manager'
  }, code)
const text = async () => ((await managerJs('document.body.innerText')) as string).toLowerCase()
const press = (rowText: string, label: string) =>
  managerJs(`(() => { const row = Array.from(document.querySelectorAll('.row')).find((r) => r.textContent.includes(${JSON.stringify(rowText)})); const b = row && Array.from(row.querySelectorAll('button')).find((x) => x.textContent === ${JSON.stringify(label)}); if (b) b.click(); return !!b })()`)

test('Manage: the Agent folders list shows a folder, its pages, and lets the person remove a page and change the lock', async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-agents-'))}`], env: { ...process.env, INSTANT_TEST_PINS: '1' } })
  await expect.poll(() => app.evaluate(() => !!(globalThis as Record<string, unknown>).__agentFolders), { timeout: 15_000 }).toBe(true)
  await app.evaluate(() => {
    const s = (globalThis as unknown as { __agentFolders: Agents }).__agentFolders
    const agent = { id: 'ag-000000000001', name: 'Test Agent' }
    const f = s.createFolder(agent, 'Research', false)
    s.add(agent, f.id, 'https://agent-one.example/', 'Agent page one')
    s.add(agent, f.id, 'https://agent-two.example/', 'Agent page two')
  })
  await app.evaluate(() => (globalThis as unknown as { __manager: { open(): void } }).__manager.open())
  await expect.poll(async () => (await text()).includes('by test agent'), { timeout: 8000 }).toBe(true)
  expect(await text()).toContain('research')
  expect(await text()).toContain('the agent may not delete')
  expect(await text()).not.toContain('agent page one')

  expect(await press('Research', 'Show pages')).toBe(true)
  await expect.poll(async () => (await text()).includes('agent page one'), { timeout: 8000 }).toBe(true)

  // The person's own Remove on a page works even though the agent may not delete.
  expect(await press('Agent page one', 'Remove')).toBe(true)
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __agentFolders: Agents }).__agentFolders.folders()[0]!.items.length)).toBe(1)
  expect(await text()).toContain('agent page two')

  // Allow deletion.
  expect(await press('Research', 'Allow deletion')).toBe(true)
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __agentFolders: Agents }).__agentFolders.folders()[0]!.allowDelete)).toBe(true)
})
