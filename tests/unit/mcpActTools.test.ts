import { expect, test } from 'vitest'
import { actTools } from '../../src/main/mcp/actTools'
import { createMcpHandler, type ActivityEntry } from '../../src/shared/mcp/protocol'

function fakePage(url: string, info: object = { tag: 'INPUT', type: 'text', autocomplete: '', editable: false }, focus?: object) {
  const events: unknown[] = []
  const typed: string[] = []
  return {
    events, typed,
    isDestroyed: () => false,
    getURL: () => url,
    getZoomFactor: () => 1,
    sendInputEvent: (e: unknown) => { events.push(e) },
    insertText: async (t: string) => { typed.push(t) },
    executeJavaScriptInIsolatedWorld: async (_w: number, scripts: Array<{ code: string }>) => {
      const code = scripts[0]!.code
      if (code.includes('getBoundingClientRect')) return { missing: false, inside: true, x: 10, y: 20 }
      if (code.includes('activeElement')) return focus ?? { focused: true, ...info }
      if (code.includes('tagName')) return info
      if (code.includes('scrollY')) return 480
      return undefined
    }
  } as any
}

function setup(opts: { act?: boolean; answer?: boolean; url?: string; info?: object; focus?: object } = {}) {
  const page = fakePage(opts.url ?? 'https://a.example/p', opts.info, opts.focus)
  const asked: Array<[string, string]> = []
  const tools = actTools({
    windowPage: (id) => (id === 7 ? page : null),
    pinPage: (id) => (id === 'off' ? 'offloaded' : null),
    approve: async (agent, origin) => { asked.push([agent.name, origin]); return opts.answer ?? true }
  })
  const log: ActivityEntry[] = []
  const handler = createMcpHandler({ name: 't', version: '1', tools: () => tools, allowed: (t) => opts.act !== false || t.group !== 'act', onChange: (e) => log.push(e) })
  let n = 0
  const rpc = async (method: string, params: object = {}) =>
    ((await handler.handle({ jsonrpc: '2.0', id: ++n, method, params }, { client: 'Claude', agentId: 'a1' })) as any).result
  const call = (name: string, args: object = {}) => rpc('tools/call', { name, arguments: args })
  return { call, rpc, page, asked, log }
}

test('click sends real mouse events at the element centre', async () => {
  const { call, page, asked } = setup()
  const r = await call('click', { windowId: 7, index: 3 })
  expect(r.isError).toBeUndefined()
  expect(r.structuredContent).toEqual({ done: true, url: 'https://a.example/p' })
  expect(page.events.map((e: any) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
  expect(asked).toEqual([['Claude', 'https://a.example']])
})

test('type inserts the text, presses Enter and never logs the text', async () => {
  const { call, page, log } = setup()
  const r = await call('type', { windowId: 7, selector: '#q', text: 'secret words', submit: true })
  expect(r.isError).toBeUndefined()
  expect(page.typed).toEqual(['secret words'])
  expect(page.events.map((e: any) => e.type)).toEqual(['keyDown', 'char', 'keyUp'])
  expect(log).toHaveLength(1)
  expect(log[0]!.args).toContain('<12 chars>')
  expect(log[0]!.args).not.toContain('secret')
})

test('type refuses password fields', async () => {
  const { call, page, log } = setup({ info: { tag: 'INPUT', type: 'password', autocomplete: '' } })
  const r = await call('type', { windowId: 7, index: 1, text: 'hunter2' })
  expect(r.isError).toBe(true)
  expect(r.content[0].text).toBe('Talaria never lets agents type into password, card or one-time-code fields.')
  expect(page.typed).toEqual([])
  expect(log[0]!.ok).toBe(false)
  expect(log[0]!.args).not.toContain('hunter2')
})

test('scroll returns scrollY; needs a direction or an element', async () => {
  const { call } = setup()
  expect((await call('scroll', { windowId: 7, direction: 'down' })).structuredContent).toEqual({ done: true, scrollY: 480 })
  expect((await call('scroll', { windowId: 7, index: 2 })).structuredContent.scrollY).toBe(480)
  expect((await call('scroll', { windowId: 7 })).isError).toBe(true)
})

test('the person can refuse, and only http pages are acted on', async () => {
  const no = setup({ answer: false })
  const r = await no.call('click', { windowId: 7, selector: 'a' })
  expect(r.isError).toBe(true)
  expect(r.content[0].text).toBe('The person did not allow this on https://a.example.')
  expect(no.page.events).toEqual([])
  const file = setup({ url: 'file:///etc/hosts' })
  expect((await file.call('click', { windowId: 7, selector: 'a' })).isError).toBe(true)
  expect(file.asked).toEqual([])
})

test('target errors: both, neither, offloaded, selector and index together', async () => {
  const { call } = setup()
  expect((await call('click', { selector: 'a' })).isError).toBe(true)
  expect((await call('click', { windowId: 7, pinId: 'x', selector: 'a' })).isError).toBe(true)
  const off = await call('click', { pinId: 'off', selector: 'a' })
  expect(off.content[0].text).toBe('That pin is offloaded. Open it first with pin_action.')
  expect((await call('click', { windowId: 7, selector: 'a', index: 1 })).isError).toBe(true)
  expect((await call('click', { windowId: 7 })).isError).toBe(true)
  expect((await call('type', { windowId: 7, selector: 'a', text: 'x'.repeat(5001) })).isError).toBe(true)
})

test('the act tools are hidden when the switch is off', async () => {
  const { rpc, call } = setup({ act: false })
  expect((await rpc('tools/list')).tools).toEqual([])
  expect((await call('click', { windowId: 7, index: 1 })).isError).toBe(true)
})

test('act calls are limited to 60 a minute per agent', async () => {
  let t = 1_000
  const page = fakePage('https://a.example/')
  const tools = actTools({ windowPage: () => page, pinPage: () => null, approve: async () => true, now: () => t })
  const scroll = tools.find((x) => x.name === 'scroll')!
  for (let i = 0; i < 60; i++) await scroll.run({ windowId: 7, direction: 'down' }, { client: 'c', agentId: 'a' })
  await expect(scroll.run({ windowId: 7, direction: 'down' }, { client: 'c', agentId: 'a' })).rejects.toThrow('Too many actions')
  t += 61_000
  await expect(scroll.run({ windowId: 7, direction: 'down' }, { client: 'c', agentId: 'a' })).resolves.toBeDefined()
}, 30_000)

test('all three tools are in the act group and log their changes', () => {
  const tools = actTools({ windowPage: () => null, pinPage: () => null, approve: async () => false })
  expect(tools.map((t) => t.name)).toEqual(['click', 'type', 'scroll'])
  for (const t of tools) { expect(t.group).toBe('act'); expect(t.changes).toBe(true); expect(t.description).toContain('untrusted') }
})

test('type checks the field that really has focus: nothing is typed when the field could not take focus (bug hunt 20)', async () => {
  // A disabled or hidden field does not take focus, so the text would go to the field that had it, maybe a password field.
  const { call, page } = setup({ focus: { focused: false } })
  const r = await call('type', { windowId: 7, selector: '#disabled', text: 'hello' })
  expect(r.isError).toBe(true)
  expect(r.content[0].text).toBe('That field cannot take text now (it may be disabled or hidden), so nothing was typed.')
  expect(page.typed).toEqual([])
})

test('type refuses when the focused field turned into a password field after the first check (bug hunt 20)', async () => {
  const { call, page } = setup({ focus: { focused: true, tag: 'INPUT', type: 'password', autocomplete: '', editable: false } })
  const r = await call('type', { windowId: 7, index: 2, text: 'hello' })
  expect(r.isError).toBe(true)
  expect(r.content[0].text).toBe('Talaria never lets agents type into password, card or one-time-code fields.')
  expect(page.typed).toEqual([])
})
