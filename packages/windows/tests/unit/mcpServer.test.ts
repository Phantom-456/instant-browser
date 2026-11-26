import { afterEach, expect, test } from 'vitest'
import { request } from 'node:http'
import { McpServer } from '../../src/main/mcp/mcpServer'
import { createMcpHandler } from '../../src/shared/mcp/protocol'

const KEY = 'secret-key'
const KEY_B = 'other-key'
const AGENTS: Record<string, { id: string; name: string }> = { [KEY]: { id: 'ag-aaaaaaaaaaaa', name: 'Alpha' }, [KEY_B]: { id: 'ag-bbbbbbbbbbbb', name: 'Beta' } }
const handler = createMcpHandler({ name: 'test', version: '1', tools: () => [{ name: 'who', group: 'read', changes: false, description: 'Who', inputSchema: { type: 'object' }, run: (_a, ctx) => ({ client: ctx.client, agentId: ctx.agentId }) }] })
let server: McpServer | null = null
afterEach(async () => { await server?.stop(); server = null })

async function boot(): Promise<number> {
  server = new McpServer({ auth: (key) => AGENTS[key] ?? null, handler })
  expect(await server.start(0)).toBe('ok')
  return server.port()
}

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: string }
function call(port: number, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string; auth?: boolean; key?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, ...(options.auth === false ? {} : { Authorization: `Bearer ${options.key ?? KEY}` }), ...options.headers }
    const req = request({ host: '127.0.0.1', port, method: options.method ?? 'POST', path: options.path ?? '/mcp', headers }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end(options.body)
  })
}
const rpc = (method: string, params: unknown = {}, notify = false) => JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: 1 }), method, params })

test('a request without the key is refused', async () => {
  const port = await boot()
  expect((await call(port, { body: rpc('ping'), auth: false })).status).toBe(401)
  expect((await call(port, { body: rpc('ping'), headers: { Authorization: 'Bearer wrong-key' } })).status).toBe(401)
})

test('a browser page (Origin) or a wrong Host is refused', async () => {
  const port = await boot()
  expect((await call(port, { body: rpc('ping'), headers: { Origin: 'https://evil.example' } })).status).toBe(403)
  expect((await call(port, { body: rpc('ping'), headers: { Host: 'evil.example' } })).status).toBe(403)
  expect((await call(port, { body: rpc('ping'), headers: { Host: `localhost:${port}` } })).status).toBe(200)
})

test('only POST /mcp', async () => {
  const port = await boot()
  const get = await call(port, { method: 'GET' })
  expect(get.status).toBe(405)
  expect(get.headers.allow).toBe('POST')
  expect((await call(port, { method: 'DELETE' })).status).toBe(405)
  expect((await call(port, { path: '/other', body: rpc('ping') })).status).toBe(404)
})

test('bad JSON gives a parse error', async () => {
  const port = await boot()
  const r = await call(port, { body: '{nope' })
  expect(r.status).toBe(400)
  expect(JSON.parse(r.body).error.code).toBe(-32700)
})

test('a good request, a notification and a too large body', async () => {
  const port = await boot()
  const ok = await call(port, { body: rpc('ping') })
  expect(ok.status).toBe(200)
  expect(ok.headers['content-type']).toBe('application/json')
  expect(JSON.parse(ok.body).result).toEqual({})
  const note = await call(port, { body: rpc('notifications/initialized', {}, true) })
  expect(note.status).toBe(202)
  expect(note.body).toBe('')
  expect((await call(port, { body: 'x'.repeat(1024 * 1024 + 10) })).status).toBe(413)
})

test('initialize gives a session id, and the name comes from the key, not clientInfo', async () => {
  const port = await boot()
  const init = await call(port, { body: rpc('initialize', { clientInfo: { name: 'Beta' } }) })
  const id = init.headers['mcp-session-id'] as string
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  const who = await call(port, { headers: { 'Mcp-Session-Id': id }, body: rpc('tools/call', { name: 'who' }) })
  expect(JSON.parse(who.body).result.structuredContent).toEqual({ client: 'Alpha', agentId: 'ag-aaaaaaaaaaaa' })
  const stranger = await call(port, { headers: { 'Mcp-Session-Id': 'unknown' }, body: rpc('tools/call', { name: 'who' }) })
  expect(JSON.parse(stranger.body).result.structuredContent).toEqual({ client: 'Alpha', agentId: 'ag-aaaaaaaaaaaa' })
})

test('each key signs in as its own agent', async () => {
  const port = await boot()
  const a = await call(port, { body: rpc('tools/call', { name: 'who' }) })
  const b = await call(port, { key: KEY_B, body: rpc('tools/call', { name: 'who' }) })
  expect(JSON.parse(a.body).result.structuredContent).toEqual({ client: 'Alpha', agentId: 'ag-aaaaaaaaaaaa' })
  expect(JSON.parse(b.body).result.structuredContent).toEqual({ client: 'Beta', agentId: 'ag-bbbbbbbbbbbb' })
})

test('a removed key gets 401', async () => {
  const port = await boot()
  expect((await call(port, { key: KEY_B, body: rpc('ping') })).status).toBe(200)
  delete AGENTS[KEY_B]
  try { expect((await call(port, { key: KEY_B, body: rpc('ping') })).status).toBe(401) } finally { AGENTS[KEY_B] = { id: 'ag-bbbbbbbbbbbb', name: 'Beta' } }
})

test('a session id from one agent is not reused by another', async () => {
  const port = await boot()
  const init = await call(port, { body: rpc('initialize', {}) })
  const id = init.headers['mcp-session-id'] as string
  const mine = await call(port, { headers: { 'Mcp-Session-Id': id }, body: rpc('tools/call', { name: 'who' }) })
  expect(JSON.parse(mine.body).result.structuredContent.agentId).toBe('ag-aaaaaaaaaaaa')
  const theirs = await call(port, { key: KEY_B, headers: { 'Mcp-Session-Id': id }, body: rpc('tools/call', { name: 'who' }) })
  expect(JSON.parse(theirs.body).result.structuredContent).toEqual({ client: 'Beta', agentId: 'ag-bbbbbbbbbbbb' })
})

test('start reports a port that is taken, and stop frees it', async () => {
  const port = await boot()
  const other = new McpServer({ auth: (key) => AGENTS[key] ?? null, handler })
  expect(await other.start(port)).toBe('in-use')
  expect(other.running()).toBe(false)
  await server!.stop()
  expect(server!.running()).toBe(false)
})
