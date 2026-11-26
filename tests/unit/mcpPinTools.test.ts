import { expect, test } from 'vitest'
import { pinTools, type PinToolDeps } from '../../src/main/mcp/pinTools'
import { createMcpHandler } from '../../src/shared/mcp/protocol'

function setup(over: Partial<PinToolDeps> = {}) {
  const active = [{ id: 'p1' }] as any[]
  const archived = [{ id: 'a1' }] as any[]
  const log: string[] = []
  const tools = pinTools({
    pins: () => active,
    archivedPins: () => archived,
    maxPins: () => 3,
    collapse: (id) => { if (id !== 7) return false; log.push('collapse 7'); active.push({ id: 'new' }); return true },
    rename: async (id, label) => { log.push(`rename ${id} ${label}`) },
    archive: async (id) => { log.push(`archive ${id}`) },
    unarchive: async (id) => { log.push(`unarchive ${id}`) },
    sleep: async () => {},
    ...over
  })
  const handler = createMcpHandler({ name: 't', version: '1', tools: () => tools })
  let n = 0
  const call = async (name: string, args: object = {}) => {
    const r = (await handler.handle({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }, { client: 'x', agentId: 'ag-000000000001' })) as any
    return r.result
  }
  return { call, log, tools, active }
}

test('pin_window collapses a window and returns the new pin id', async () => {
  const { call, log } = setup()
  const r = await call('pin_window', { windowId: 7 })
  expect(r.structuredContent).toEqual({ pinned: true, id: 'new' })
  expect(log).toEqual(['collapse 7'])
})

test('pin_window says pinned without an id when the pin does not show up', async () => {
  const { call } = setup({ collapse: () => true })
  expect((await call('pin_window', { windowId: 7 })).structuredContent).toEqual({ pinned: true })
})

test('pin_window refuses an unknown window and a full pin limit', async () => {
  const { call, active, log } = setup()
  const gone = await call('pin_window', { windowId: 9 })
  expect(gone.isError).toBe(true)
  expect(gone.content[0].text).toContain('list_windows')
  expect((await call('pin_window', { windowId: 'x' })).isError).toBe(true)
  active.push({ id: 'p2' }, { id: 'p3' })
  const full = await call('pin_window', { windowId: 7 })
  expect(full.isError).toBe(true)
  expect(full.content[0].text).toContain('limit')
  expect(log).toEqual([])
})

test('rename_pin sets and clears a label, with a length limit', async () => {
  const { call, log } = setup()
  await call('rename_pin', { id: 'p1', label: 'News' })
  await call('rename_pin', { id: 'p1', label: '' })
  expect(log).toEqual(['rename p1 News', 'rename p1 '])
  expect((await call('rename_pin', { id: 'p1', label: 'x'.repeat(61) })).isError).toBe(true)
  const unknown = await call('rename_pin', { id: 'nope', label: 'a' })
  expect(unknown.isError).toBe(true)
  expect(unknown.content[0].text).toContain('list_pins')
})

test('archive_pin and unarchive_pin work on the right pins', async () => {
  const { call, log, tools } = setup()
  await call('archive_pin', { id: 'p1' })
  await call('unarchive_pin', { id: 'a1' })
  expect(log).toEqual(['archive p1', 'unarchive a1'])
  for (const [name, id] of [['archive_pin', 'a1'], ['archive_pin', 'nope'], ['unarchive_pin', 'p1'], ['unarchive_pin', 'nope']]) {
    const r = await call(name!, { id })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('list_pins')
  }
  expect(log).toHaveLength(2)
  expect(tools.find((t) => t.name === 'archive_pin')!.description).toMatch(/undone.*never delete/)
})
