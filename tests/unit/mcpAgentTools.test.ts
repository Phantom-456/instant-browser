import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { AgentBookmarkStore } from '../../src/main/agentBookmarkStore'
import { agentBookmarkTools } from '../../src/main/mcp/agentTools'
import { createMcpHandler } from '../../src/shared/mcp/protocol'

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-tools-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function setup() {
  const store = new AgentBookmarkStore(join(dir, 'a.json'))
  const handler = createMcpHandler({ name: 't', version: '1', tools: () => agentBookmarkTools(store) })
  const session = (client: string, claimed?: string) => ({ client, agentId: `ag-${Buffer.from(client.toLowerCase()).toString('hex').padEnd(12, '0').slice(0, 12)}`, clientInfo: claimed })
  let n = 0
  const call = async (client: string, name: string, args: object = {}, claimed?: string) => {
    const r = (await handler.handle({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }, session(client, claimed))) as any
    return r.result
  }
  return { store, call }
}

test('the six tools are listed with strict schemas', async () => {
  const names = agentBookmarkTools(new AgentBookmarkStore(join(dir, 'a.json'))).map((t) => t.name)
  expect(names).toEqual(['list_agent_folders', 'list_agent_folder', 'create_bookmark_folder', 'add_bookmark', 'remove_bookmark', 'delete_bookmark_folder'])
  for (const t of agentBookmarkTools(new AgentBookmarkStore(join(dir, 'b.json')))) expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
})

test('create, add, list, and refused delete', async () => {
  const { call } = setup()
  const made = await call('Claude Code', 'create_bookmark_folder', { name: 'Reading' })
  expect(made.isError).toBeUndefined()
  const id = made.structuredContent.id
  expect(made.structuredContent).toMatchObject({ owner: 'Claude Code', allowDelete: false, mine: true, count: 0 })
  const added = await call('Claude Code', 'add_bookmark', { folderId: id, url: 'https://a.example', title: 'A' })
  const bm = added.structuredContent.id
  const refused = await call('Claude Code', 'remove_bookmark', { folderId: id, bookmarkId: bm })
  expect(refused.isError).toBe(true)
  expect(refused.content[0].text).toContain('only the person can change it')
  const mine = await call('Codex', 'list_agent_folders')
  expect(mine.structuredContent.folders[0]).toMatchObject({ mine: false, count: 1 })
  const read = await call('Codex', 'list_agent_folder', { folderId: id })
  expect(read.structuredContent.items).toHaveLength(1)
  expect((await call('Codex', 'add_bookmark', { folderId: id, url: 'https://b.example' })).isError).toBe(true)
})

test('a folder made with allowDelete: the owner removes and deletes; others cannot', async () => {
  const { call, store } = setup()
  const id = (await call('a', 'create_bookmark_folder', { name: 'F', allowDelete: true })).structuredContent.id
  const bm = (await call('a', 'add_bookmark', { folderId: id, url: 'https://a.example' })).structuredContent.id
  expect(await call('a', 'set_folder_permission', { folderId: id, allowDelete: false })).toBeUndefined() // no such tool: a JSON-RPC error, no result
  expect((await call('b', 'remove_bookmark', { folderId: id, bookmarkId: bm })).isError).toBe(true)
  expect((await call('a', 'remove_bookmark', { folderId: id, bookmarkId: bm })).isError).toBeUndefined()
  expect((await call('a', 'delete_bookmark_folder', { folderId: id })).structuredContent).toEqual({ deleted: true })
  expect(store.folders()).toHaveLength(0)
  expect((await call('a', 'list_agent_folder', { folderId: id })).isError).toBe(true)
})

test('an agent cannot act as another, even when its clientInfo claims the other name', async () => {
  const { call, store } = setup()
  const id = (await call('A', 'create_bookmark_folder', { name: 'F', allowDelete: true })).structuredContent.id
  await call('A', 'add_bookmark', { folderId: id, url: 'https://a.example' })
  const add = await call('B', 'add_bookmark', { folderId: id, url: 'https://b.example' }, 'A')
  expect(add.isError).toBe(true)
  expect((await call('B', 'delete_bookmark_folder', { folderId: id }, 'A')).isError).toBe(true)
  expect(store.folder(id).items).toHaveLength(1)
  const listed = await call('B', 'list_agent_folders', {}, 'A')
  expect(listed.structuredContent.folders[0]).toMatchObject({ owner: 'A', mine: false })
  expect((await call('A', 'delete_bookmark_folder', { folderId: id })).structuredContent).toEqual({ deleted: true })
})

test('add_bookmark with items saves 50 pages in one file write and reports each result', async () => {
  const { store, call } = setup()
  const f = (await call('A', 'create_bookmark_folder', { name: 'Batch' })).structuredContent
  const saves: number[] = []
  store.onChange = () => saves.push(1)
  const items = Array.from({ length: 50 }, (_, i) => ({ url: `https://p${i}.example/`, title: `P${i}` }))
  const r = (await call('A', 'add_bookmark', { folderId: f.id, items })).structuredContent
  expect(r).toMatchObject({ added: 50, exists: 0, errors: 0 })
  expect(saves.length).toBe(1)
  expect(store.folder(f.id).items.length).toBe(50)
})

test('one bad item does not stop the rest; repeats say exists; single url still works', async () => {
  const { call } = setup()
  const f = (await call('A', 'create_bookmark_folder', { name: 'Mix' })).structuredContent
  await call('A', 'add_bookmark', { folderId: f.id, url: 'https://old.example/' })
  const r = (await call('A', 'add_bookmark', { folderId: f.id, items: [{ url: 'https://new.example/' }, { url: 'javascript:alert(1)' }, { url: 'https://old.example/' }] })).structuredContent
  expect(r.results.map((x: any) => x.status)).toEqual(['added', 'error', 'exists'])
  expect(r).toMatchObject({ added: 1, exists: 1, errors: 1 })
  const one = await call('A', 'add_bookmark', { folderId: f.id, url: 'https://one.example/', title: 'One' })
  expect(one.structuredContent).toMatchObject({ title: 'One', url: 'https://one.example/' })
})

test('add_bookmark refuses 51 items, both forms together, neither form, and another agent\'s folder', async () => {
  const { call } = setup()
  const f = (await call('A', 'create_bookmark_folder', { name: 'Own' })).structuredContent
  const many = Array.from({ length: 51 }, (_, i) => ({ url: `https://p${i}.example/` }))
  expect((await call('A', 'add_bookmark', { folderId: f.id, items: many })).isError).toBe(true)
  expect((await call('A', 'add_bookmark', { folderId: f.id, items: [{ url: 'https://a.example/' }], url: 'https://b.example/' })).isError).toBe(true)
  expect((await call('A', 'add_bookmark', { folderId: f.id })).isError).toBe(true)
  expect((await call('B', 'add_bookmark', { folderId: f.id, items: [{ url: 'https://a.example/' }] })).isError).toBe(true)
})
