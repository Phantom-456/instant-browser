import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createMcpHandler, shortArgs, type ActivityEntry, type McpTool } from '../../src/shared/mcp/protocol'
import { ActivityLog } from '../../src/main/mcp/activityLog'

const tools: McpTool[] = [
  { name: 'peek', group: 'read', changes: false, description: '', inputSchema: { type: 'object' }, run: () => ({ ok: 1 }) },
  { name: 'make', group: 'folders', changes: true, description: '', inputSchema: { type: 'object' }, run: () => ({ made: true }) },
  { name: 'fail', group: 'windows', changes: true, description: '', inputSchema: { type: 'object' }, run: () => { throw new Error('nope') } }
]

function setup(off: string[] = []) {
  const logged: ActivityEntry[] = []
  const handler = createMcpHandler({ name: 't', version: '1', tools: () => tools, allowed: (t) => !off.includes(t.group), onChange: (e) => logged.push(e) })
  const call = async (name: string, args: object = {}) => (await handler.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { client: 'codex', agentId: 'ag-000000000001' })) as any
  return { handler, call, logged }
}

test('a switched-off tool is hidden and refused', async () => {
  const { handler, call, logged } = setup(['folders'])
  const list = (await handler.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { client: 'x', agentId: 'ag-000000000001' })) as any
  expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['peek', 'fail'])
  const r = await call('make')
  expect(r.error).toBeUndefined()
  expect(r.result.isError).toBe(true)
  expect(r.result.content[0].text).toBe('This kind of tool is switched off in Instant Browser (Settings > Agents).')
  expect(logged).toHaveLength(0)
})

test('read tools are not logged', async () => {
  const { call, logged } = setup()
  await call('peek')
  expect(logged).toHaveLength(0)
})

test('change tools are logged on success and on error', async () => {
  const { call, logged } = setup()
  await call('make', { name: 'A' })
  await call('fail', { url: 'x' })
  expect(logged).toHaveLength(2)
  expect(logged[0]).toMatchObject({ agent: 'codex', tool: 'make', args: '{"name":"A"}', ok: true, message: '' })
  expect(logged[1]).toMatchObject({ tool: 'fail', ok: false, message: 'nope' })
  expect(typeof logged[0]!.time).toBe('number')
})

test('shortArgs trims strings and the whole text', () => {
  expect(JSON.parse(shortArgs({ a: 'x'.repeat(500) })).a).toHaveLength(120)
  expect(shortArgs({ a: 1 })).toBe('{"a":1}')
  const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 'y'.repeat(100)]))
  expect(shortArgs(big).length).toBe(400)
})

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'activity-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const entry = (n: number): ActivityEntry => ({ time: n, agent: 'a', tool: 't', args: '{}', ok: true, message: '' })

test('the log appends and survives a restart', () => {
  const path = join(dir, 'a.jsonl')
  const log = new ActivityLog(path)
  log.add(entry(1))
  log.add(entry(2))
  expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2)
  expect(new ActivityLog(path).recent().map((e) => e.time)).toEqual([2, 1])
})

test('the log keeps only the newest max lines', () => {
  const path = join(dir, 'a.jsonl')
  const log = new ActivityLog(path, 5)
  for (let i = 1; i <= 8; i++) log.add(entry(i))
  expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(5)
  expect(log.recent().map((e) => e.time)).toEqual([8, 7, 6, 5, 4])
  expect(log.recent(2).map((e) => e.time)).toEqual([8, 7])
})

test('a broken line is skipped', () => {
  const path = join(dir, 'a.jsonl')
  writeFileSync(path, JSON.stringify(entry(1)) + '\n{broken\n')
  appendFileSync(path, JSON.stringify(entry(2)) + '\n')
  expect(new ActivityLog(path).recent().map((e) => e.time)).toEqual([2, 1])
})

test.skipIf(process.platform === 'win32')('the file is private', () => {
  const path = join(dir, 'a.jsonl')
  const log = new ActivityLog(path, 2)
  log.add(entry(1))
  expect(statSync(path).mode & 0o777).toBe(0o600)
  log.add(entry(2))
  log.add(entry(3)) // rewritten
  expect(statSync(path).mode & 0o777).toBe(0o600)
})

test('clear empties the list and the file', () => {
  const path = join(dir, 'a.jsonl')
  const log = new ActivityLog(path)
  log.add(entry(1))
  log.clear()
  expect(log.recent()).toEqual([])
  expect(existsSync(path)).toBe(false)
})
