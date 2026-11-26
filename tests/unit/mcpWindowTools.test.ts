import { expect, test } from 'vitest'
import { windowTools } from '../../src/main/mcp/windowTools'
import { createMcpHandler } from '../../src/shared/mcp/protocol'

function setup() {
  const opened: string[] = []
  const closed: number[] = []
  const live = new Set<number>()
  let next = 100
  const acts: Array<[string, string]> = []
  let t = 1000
  const navs: Array<[number, string]> = []
  const history = { back: false, forward: false }
  let reloads = 0
  const tools = windowTools({
    open: (u) => { opened.push(u); live.add(++next); return next },
    close: (id) => { closed.push(id); return live.delete(id) },
    windows: () => [{ id: 5, title: 'A', url: 'https://a.example' }],
    show: (id) => id === 5,
    navigate: (id, u) => { if (id !== 5) return false; navs.push([id, u]); return true },
    step: (id, dir) => (id === 5 ? history[dir] : null),
    reload: (id) => { if (id !== 5) return false; reloads++; return true },
    pins: () => [{ id: 'p1' } as any],
    pinAct: async (id, a) => { acts.push([id, a]) },
    now: () => t
  })
  const handler = createMcpHandler({ name: 't', version: '1', tools: () => tools })
  let n = 0
  const as = (agentId: string) => async (name: string, args: object = {}) => {
    const r = (await handler.handle({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }, { client: 'x', agentId })) as any
    return r.result
  }
  const call = as('ag-000000000001')
  return { call, as, navs, history, reloads: () => reloads, closed, opened, acts, tools, tick: (ms: number) => { t += ms } }
}

test('open_window accepts https and rejects other addresses', async () => {
  const { call, opened } = setup()
  const ok = await call('open_window', { url: 'https://example.com/a' })
  expect(ok.isError).toBeUndefined()
  expect(ok.structuredContent).toEqual({ opened: true, id: 101, url: 'https://example.com/a' })
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url']) expect((await call('open_window', { url })).isError).toBe(true)
  expect(opened).toEqual(['https://example.com/a'])
})

test('open_window allows 5 per minute for each agent', async () => {
  const { call, as, tick } = setup()
  for (let i = 0; i < 5; i++) expect((await call('open_window', { url: 'https://a.example' })).isError).toBeUndefined()
  const over = await call('open_window', { url: 'https://a.example' })
  expect(over.isError).toBe(true)
  expect(over.content[0].text).toContain('Too many windows')
  const other = as('ag-000000000002') // another agent has its own count
  expect((await other('open_window', { url: 'https://a.example' })).isError).toBeUndefined()
  tick(61_000)
  expect((await call('open_window', { url: 'https://a.example' })).isError).toBeUndefined()
})

test('close_window works only on a window the same agent opened', async () => {
  const { call, as, closed } = setup()
  const other = as('ag-000000000002')
  const id = (await call('open_window', { url: 'https://a.example' })).structuredContent.id
  const refused = await other('close_window', { id })
  expect(refused.isError).toBe(true)
  expect(refused.content[0].text).toBe('You can only close windows you opened.')
  expect((await call('close_window', { id: 5 })).isError).toBe(true) // the person's window
  expect(closed).toEqual([])
  expect((await call('close_window', { id })).structuredContent).toEqual({ closed: true })
  expect(closed).toEqual([id])
  expect((await call('close_window', { id })).isError).toBe(true) // already closed
})

test('focus_window finds a window or says how to list them', async () => {
  const { call } = setup()
  expect((await call('focus_window', { id: 5 })).isError).toBeUndefined()
  const r = await call('focus_window', { id: 9 })
  expect(r.isError).toBe(true)
  expect(r.content[0].text).toContain('list_windows')
})

test('pin_action maps open and offload, and there is no remove', async () => {
  const { call, acts, tools } = setup()
  await call('pin_action', { id: 'p1', action: 'open' })
  await call('pin_action', { id: 'p1', action: 'offload' })
  expect(acts).toEqual([['p1', 'restore'], ['p1', 'offload']])
  const unknown = await call('pin_action', { id: 'nope', action: 'open' })
  expect(unknown.isError).toBe(true)
  expect(unknown.content[0].text).toContain('list_pins')
  expect((await call('pin_action', { id: 'p1', action: 'remove' })).isError).toBe(true)
  const schema = tools.find((x) => x.name === 'pin_action')!.inputSchema as any
  expect(schema.properties.action.enum).toEqual(['open', 'offload'])
  expect(acts).toHaveLength(2)
})

test('navigate_window loads http and https only, in an open window', async () => {
  const { call, navs } = setup()
  const ok = await call('navigate_window', { id: 5, url: 'https://b.example/x' })
  expect(ok.structuredContent).toEqual({ id: 5, url: 'https://b.example/x' })
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd']) expect((await call('navigate_window', { id: 5, url })).isError).toBe(true)
  expect(navs).toEqual([[5, 'https://b.example/x']])
})

test('window moves on an unknown id are errors that point to list_windows', async () => {
  const { call } = setup()
  for (const [name, args] of [['navigate_window', { id: 9, url: 'https://a.example' }], ['go_back', { id: 9 }], ['go_forward', { id: 9 }], ['reload_window', { id: 9 }]] as const) {
    const r = await call(name, args)
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('list_windows')
  }
})

test('navigate_window shares the open_window limit for each agent', async () => {
  const { call, as, tick } = setup()
  for (let i = 0; i < 3; i++) await call('open_window', { url: 'https://a.example' })
  for (let i = 0; i < 2; i++) expect((await call('navigate_window', { id: 5, url: 'https://a.example' })).isError).toBeUndefined()
  expect((await call('navigate_window', { id: 5, url: 'https://a.example' })).isError).toBe(true)
  expect((await call('open_window', { url: 'https://a.example' })).isError).toBe(true)
  expect((await as('ag-000000000002')('navigate_window', { id: 5, url: 'https://a.example' })).isError).toBeUndefined()
  tick(61_000)
  expect((await call('navigate_window', { id: 5, url: 'https://a.example' })).isError).toBeUndefined()
})

test('go_back and go_forward return done false when there is no history', async () => {
  const { call, history } = setup()
  expect((await call('go_back', { id: 5 })).structuredContent).toEqual({ done: false, reason: 'Nothing to go back to.' })
  expect((await call('go_forward', { id: 5 })).structuredContent).toEqual({ done: false, reason: 'Nothing to go forward to.' })
  history.back = true
  const r = await call('go_back', { id: 5 })
  expect(r.isError).toBeUndefined()
  expect(r.structuredContent).toEqual({ id: 5, url: 'https://a.example' })
})

test('reload_window calls through', async () => {
  const { call, reloads } = setup()
  expect((await call('reload_window', { id: 5 })).structuredContent).toEqual({ id: 5, url: 'https://a.example' })
  expect(reloads()).toBe(1)
})

test('list_windows says who opened a window, and a closed window drops out', async () => {
  const { WindowOwners } = await import('../../src/main/mcp/windowOwners')
  const { browserTools } = await import('../../src/main/mcp/tools')
  const owners = new WindowOwners()
  let open = [
    { id: 5, title: 'Mine', url: 'https://a.example', focused: true, bounds: { x: 1, y: 2, width: 300, height: 400 } },
    { id: 6, title: 'A1', url: 'https://b.example' },
    { id: 7, title: 'A2', url: 'https://c.example' }
  ]
  owners.add('ag-1', 6)
  owners.add('ag-2', 7)
  const list = browserTools({ windows: () => open, owners } as any).find((t) => t.name === 'list_windows')!
  const as = async (agentId: string) => ((await list.run({}, { client: 'x', agentId })) as any).windows
  const one = await as('ag-1')
  expect(one.map((w: any) => [w.id, w.openedByYou, w.openedByAgent, w.canClose])).toEqual([[5, false, false, false], [6, true, true, true], [7, false, true, false]])
  expect(one[0]).toMatchObject({ focused: true, bounds: { x: 1, y: 2, width: 300, height: 400 } })
  expect(JSON.stringify(one)).not.toContain('ag-2')
  open = open.filter((w) => w.id !== 6)
  await as('ag-1')
  expect(owners.hasOwner(6)).toBe(false)
  expect(owners.owns('ag-1', 6)).toBe(false)
})

test('close_window uses the shared owners, and the person\'s windows stay closed to agents', async () => {
  const { WindowOwners } = await import('../../src/main/mcp/windowOwners')
  const owners = new WindowOwners()
  const closed: number[] = []
  const tools = windowTools({ owners, open: () => 9, close: (id) => { closed.push(id); return true }, windows: () => [], show: () => true, navigate: () => true, step: () => true, reload: () => true, pins: () => [], pinAct: async () => {} })
  const run = (name: string, args: object, agentId = 'ag-1') => tools.find((t) => t.name === name)!.run(args as any, { client: 'x', agentId })
  await run('open_window', { url: 'https://a.example' })
  expect(owners.owns('ag-1', 9)).toBe(true)
  await expect(async () => run('close_window', { id: 9 }, 'ag-2')).rejects.toThrow()
  await expect(async () => run('close_window', { id: 5 })).rejects.toThrow()
  await run('close_window', { id: 9 })
  expect(closed).toEqual([9])
  expect(owners.hasOwner(9)).toBe(false)
})

test('open_window with urls: each opened window costs one of the 5 per minute, and a 6th address in the call is refused', async () => {
  const { call, opened, tick } = setup()
  const six = await call('open_window', { urls: Array.from({ length: 6 }, (_, i) => `https://a${i}.example`) })
  expect(six.isError).toBe(true)
  expect(opened).toEqual([])
  const first = (await call('open_window', { urls: ['https://a.example/1', 'https://a.example/2', 'https://a.example/3'] })).structuredContent
  expect(first).toMatchObject({ opened: 3, errors: 0 })
  const second = (await call('open_window', { urls: ['https://b.example/1', 'https://b.example/2', 'https://b.example/3', 'bad address'] })).structuredContent
  expect(second.results.map((r: any) => r.status)).toEqual(['opened', 'opened', 'error', 'error'])
  expect(second.results[2].error).toMatch(/Too many/)
  expect(opened.length).toBe(5)
  tick(61_000)
  expect((await call('open_window', { urls: ['https://c.example'] })).structuredContent.opened).toBe(1)
})

test('open_window focus false passes through, and the default is to focus', async () => {
  const seen: Array<[string, unknown]> = []
  const tools = windowTools({ open: (u, o) => { seen.push([u, o]); return 1 }, close: () => true, windows: () => [], show: () => true, navigate: () => true, step: () => true, reload: () => true, pins: () => [], pinAct: async () => {} })
  const open = tools.find((t) => t.name === 'open_window')!
  await open.run({ url: 'https://a.example', focus: false }, { client: 'x', agentId: 'ag-1' })
  await open.run({ url: 'https://b.example' }, { client: 'x', agentId: 'ag-1' })
  expect(seen).toEqual([['https://a.example/', { focus: false }], ['https://b.example/', { focus: true }]])
})

test('reuseIfOpen returns the open window with no budget spent, and the person\'s window stays closed to the agent', async () => {
  const { WindowOwners } = await import('../../src/main/mcp/windowOwners')
  const owners = new WindowOwners()
  const opened: string[] = []
  const win = [{ id: 5, title: 'Mine', url: 'https://a.example/' }]
  const tools = windowTools({ owners, open: (u) => { opened.push(u); return 20 + opened.length }, close: () => true, windows: () => win, show: () => true, navigate: () => true, step: () => true, reload: () => true, pins: () => [], pinAct: async () => {} })
  const open = tools.find((t) => t.name === 'open_window')!
  const close = tools.find((t) => t.name === 'close_window')!
  const ctx = { client: 'x', agentId: 'ag-1' }
  for (let i = 0; i < 10; i++) {
    expect(await open.run({ url: 'https://a.example', reuseIfOpen: true }, ctx)).toEqual({ opened: false, reused: true, id: 5, url: 'https://a.example/', canClose: false })
  }
  expect(opened).toEqual([]) // nothing opened and nothing spent
  expect(() => close.run({ id: 5 }, ctx)).toThrow('only close windows you opened')
  // 5 real opens still work after 10 reuses, and the same address twice in one call opens once
  const r = (await open.run({ urls: ['https://n.example', 'https://n.example'], reuseIfOpen: true }, ctx)) as any
  expect(r.results.map((x: any) => x.status)).toEqual(['opened', 'reused'])
  expect(r.results[1].canClose).toBe(true)
  expect(opened.length).toBe(1)
})
