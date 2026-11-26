import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication

test.afterAll(async () => { await app?.close() })

type Agent = { id: string; name: string }
type Agents = { createFolder(caller: Agent, name: string, allowDelete: boolean): { id: string }; add(caller: Agent, folderId: string, url: string, title: string): unknown; folders(): Array<{ items: unknown[] }> }
type Bm = { list(): Array<{ url: string }> }
const managerJs = (code: string) =>
  app.evaluate(async ({ webContents }, c) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/manager/'))
    return wc ? await wc.executeJavaScript(c) : 'no manager'
  }, code)
const text = async () => ((await managerJs('document.body.innerText')) as string).toLowerCase()
const press = (rowText: string, label: string) =>
  managerJs(`(() => { const row = Array.from(document.querySelectorAll('.row')).find((r) => r.textContent.includes(${JSON.stringify(rowText)})); const b = row && Array.from(row.querySelectorAll('button')).find((x) => x.textContent === ${JSON.stringify(label)}); if (b) b.click(); return !!b })()`)

test('Manage: the Agent folders tab lists a folder, and a page can be moved to my bookmarks', async () => {
  app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ib-agents-'))}`], env: { ...process.env, INSTANT_TEST_PINS: '1' } })
  await expect.poll(() => app.evaluate(() => !!(globalThis as Record<string, unknown>).__agentFolders && !!(globalThis as Record<string, unknown>).__bookmarks), { timeout: 15_000 }).toBe(true)
  await app.evaluate(() => {
    const s = (globalThis as unknown as { __agentFolders: Agents }).__agentFolders
    const agent = { id: 'ag-000000000001', name: 'Test Agent' } // folders belong to an agent's key (v6)
    const f = s.createFolder(agent, 'Research', false)
    s.add(agent, f.id, 'https://agent-one.example/', 'Agent page one')
    s.add(agent, f.id, 'https://agent-two.example/', 'Agent page two')
  })
  await app.evaluate(() => (globalThis as unknown as { __manager: { open(): void } }).__manager.open())
  await expect.poll(async () => (await text()).includes('agent folders'), { timeout: 8000 }).toBe(true)

  // The tab shows the folder (its pages are inside, closed).
  await managerJs("[...document.querySelectorAll('#tabs .tab')].find((b) => b.textContent.startsWith('Agent folders')).click()")
  await expect.poll(async () => (await text()).includes('by test agent'), { timeout: 8000 }).toBe(true)
  expect(await text()).toContain('research')
  expect(await text()).toContain('not allowed')
  expect(await text()).not.toContain('agent page one')

  // Open the folder: the pages show.
  await managerJs("document.querySelector('button.row.folder').click()")
  await expect.poll(async () => (await text()).includes('agent page one'), { timeout: 8000 }).toBe(true)

  // Move one page to my bookmarks: it is in my bookmarks and gone from the folder.
  expect(await press('Agent page one', 'Move to my bookmarks')).toBe(true)
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __bookmarks: Bm }).__bookmarks.list().some((b) => b.url.includes('agent-one')))).toBe(true)
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __agentFolders: Agents }).__agentFolders.folders()[0]!.items.length)).toBe(1)
  await expect.poll(async () => (await text()).includes('agent page one')).toBe(false)
  expect(await text()).toContain('agent page two')
})
