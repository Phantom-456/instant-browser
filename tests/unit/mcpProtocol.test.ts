import { expect, test } from 'vitest'
import { bool, createMcpHandler, int, str, type McpTool } from '../../src/shared/mcp/protocol'

const tools: McpTool[] = [
  { name: 'echo', group: 'read', changes: false, description: 'Echo', inputSchema: { type: 'object' }, run: (a, ctx) => ({ said: a.text, client: ctx.client }) },
  { name: 'list', group: 'read', changes: false, description: 'List', inputSchema: { type: 'object' }, run: () => [1, 2] },
  { name: 'boom', group: 'read', changes: false, description: 'Boom', inputSchema: { type: 'object' }, run: () => { throw new Error('it broke') } }
]
const handler = createMcpHandler({ name: 'talaria', version: '1.0.0', tools: () => tools })
const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: '2.0', id, method, params })
type Reply = { result?: Record<string, any>; error?: { code: number } }
const ask = async (message: unknown, session = { client: 'agent', agentId: 'ag-000000000001' }) => (await handler.handle(message, session)) as Reply

test('initialize echoes a known version and keeps the client name from the key', async () => {
  const session: { client: string; agentId: string; clientInfo?: string } = { client: 'Codex', agentId: 'ag-000000000001' }
  const r = await ask(rpc('initialize', { protocolVersion: '2024-11-05', clientInfo: { name: '  other  ' } }), session)
  expect(r.result?.protocolVersion).toBe('2024-11-05')
  expect(r.result?.serverInfo).toEqual({ name: 'talaria', version: '1.0.0' })
  expect(session.client).toBe('Codex') // identity is not taken from clientInfo
  expect(session.clientInfo).toBe('other')
  expect((await ask(rpc('initialize', { protocolVersion: '1999-01-01' }))).result?.protocolVersion).toBe('2025-06-18')
})

test('the clientInfo name is only for display, and is cut', async () => {
  const session: { client: string; agentId: string; clientInfo?: string } = { client: 'x', agentId: 'ag-000000000001' }
  await ask(rpc('initialize', {}), session)
  expect(session.clientInfo).toBeUndefined()
  await ask(rpc('initialize', { clientInfo: { name: 'a'.repeat(100) } }), session)
  expect(session.clientInfo).toHaveLength(60)
  expect(session.client).toBe('x')
})

test('ping and tools/list', async () => {
  expect((await ask(rpc('ping'))).result).toEqual({})
  const list = await ask(rpc('tools/list'))
  expect(list.result?.tools.map((t: { name: string }) => t.name)).toEqual(['echo', 'list', 'boom'])
})

test('tools/call returns text and structured content', async () => {
  const r = await ask(rpc('tools/call', { name: 'echo', arguments: { text: 'hi' } }), { client: 'codex', agentId: 'ag-000000000001' })
  expect(r.result?.structuredContent).toEqual({ said: 'hi', client: 'codex' })
  expect(JSON.parse(r.result?.content[0].text)).toEqual({ said: 'hi', client: 'codex' })
  expect((await ask(rpc('tools/call', { name: 'list' }))).result?.structuredContent).toEqual({ result: [1, 2] })
})

test('a tool that throws gives isError, not a JSON-RPC error', async () => {
  const r = await ask(rpc('tools/call', { name: 'boom' }))
  expect(r.error).toBeUndefined()
  expect(r.result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'it broke' }] })
})

test('errors: unknown tool, unknown method, invalid request', async () => {
  expect((await ask(rpc('tools/call', { name: 'nope' }))).error?.code).toBe(-32602)
  expect((await ask(rpc('nope'))).error?.code).toBe(-32601)
  expect((await ask({ hello: 1 })).error?.code).toBe(-32600)
  expect((await ask('text')).error?.code).toBe(-32600)
  expect((await ask([])).error?.code).toBe(-32600)
})

test('a notification gets no answer', async () => {
  expect(await handler.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, { client: 'a', agentId: 'ag-000000000001' })).toBeNull()
})

test('a batch answers each request and skips notifications', async () => {
  const r = (await handler.handle([rpc('ping', undefined, 1), { jsonrpc: '2.0', method: 'notifications/x' }, rpc('ping', undefined, 2)], { client: 'a', agentId: 'ag-000000000001' })) as object[]
  expect(r).toHaveLength(2)
  expect(await handler.handle([{ jsonrpc: '2.0', method: 'notifications/x' }], { client: 'a', agentId: 'ag-000000000001' })).toBeNull()
})

test('argument helpers check their input', () => {
  expect(str({ a: 'x' }, 'a', 5)).toBe('x')
  expect(str({}, 'a', 5)).toBe('')
  expect(() => str({}, 'a', 5, true)).toThrow('required')
  expect(() => str({ a: 1 }, 'a', 5)).toThrow('text')
  expect(() => str({ a: 'toolong' }, 'a', 5)).toThrow('too long')
  expect(int({}, 'n', 7, 1, 10)).toBe(7)
  expect(() => int({ n: 11 }, 'n', 7, 1, 10)).toThrow('between')
  expect(() => int({ n: 1.5 }, 'n', 7, 1, 10)).toThrow('whole')
  expect(bool({}, 'b', true)).toBe(true)
  expect(() => bool({ b: 'yes' }, 'b', false)).toThrow('true or false')
})
