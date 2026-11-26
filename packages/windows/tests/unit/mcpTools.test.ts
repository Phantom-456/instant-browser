import { expect, test } from 'vitest'
import { browserTools } from '../../src/main/mcp/tools'
import type { PinRecord } from '../../src/shared/pins/model'

const pin = (id: string, archived: boolean): PinRecord => ({
  id, url: `https://${id}.example/`, title: id, label: null, icon: 'data:image/png;base64,AAAA', state: 'resident', archived,
  archivedAt: null, following: false, gradient: {} as PinRecord['gradient'], window: { x: 0, y: 0, width: 1, height: 1 }, anchor: null,
  pin: { x: 0, y: 0 }, scroll: null, snapshotAt: 5, createdAt: 1000, lastUsedAt: 2000, restoredAt: null
})
const tools = browserTools({
  history: (f) => { const pages = Array.from({ length: 3 }, (_, i) => ({ url: `https://h${i}.example`, title: `Page ${i}`, visits: i + 1, lastVisit: 0, sources: ['Instant Browser'] })).filter((p) => !f.query || p.title.toLowerCase().includes(f.query.toLowerCase())); return { total: pages.length, pages: pages.slice(f.offset ?? 0, (f.offset ?? 0) + f.limit), nextOffset: null } },
  pins: () => [pin('one', false)],
  archivedPins: () => [pin('old', true)],
  windows: () => [{ id: 1, title: 'Win', url: 'https://w.example' }],
  sitePermissions: () => [{ origin: 'https://a.example', permission: 'media:video', decision: 'allow' }, { origin: 'https://b.example', permission: 'geolocation', decision: 'deny' }],
  downloads: (limit) => Array.from({ length: Math.min(limit, 5) }, (_, i) => ({ url: `https://d.example/${i}`, filename: `f${i}.zip`, savePath: `/dl/f${i}.zip`, state: 'completed', receivedBytes: 10, totalBytes: 10, startedAt: 1000 * i })).reverse()
})
const run = async (name: string, args: Record<string, unknown> = {}) => (await tools.find((t) => t.name === name)!.run(args, { client: 't', agentId: 'ag-000000000001' })) as any

test('every tool is read-only and has a strict object schema', () => {
  expect(tools.map((t) => t.name)).toEqual(['list_history', 'list_pins', 'list_windows', 'list_site_permissions', 'list_downloads'])
  for (const t of tools) expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
  for (const t of tools) expect(t.description.toLowerCase()).toContain('read-only')
})

test('list_history filters and limits', async () => {
  const h = await run('list_history', { query: 'page 1' })
  expect(h.pages).toEqual([{ url: 'https://h1.example', title: 'Page 1', visits: 2, lastVisit: '1970-01-01T00:00:00.000Z', sources: ['Instant Browser'], lastVisitBySource: { 'Instant Browser': '1970-01-01T00:00:00.000Z' } }])
  expect(h.total).toBe(1)
  expect(h.nextOffset).toBeNull()
})

test('list_history refuses bad dates and an empty time range', async () => {
  await expect(run('list_history', { since: 'yesterday' })).rejects.toThrow('ISO')
  await expect(run('list_history', { before: '2026-13-45' })).rejects.toThrow('ISO')
  await expect(run('list_history', { since: '2026-11-24T00:00:00Z', before: '2026-11-23T00:00:00Z' })).rejects.toThrow('earlier')
  await expect(run('list_history', { offset: 100001 })).rejects.toThrow('between')
})

test('list_pins leaves out archived pins by default and never shows icons or snapshots', async () => {
  expect((await run('list_pins')).pins.map((p: { id: string }) => p.id)).toEqual(['one'])
  const all = await run('list_pins', { includeArchived: true })
  expect(all.pins.map((p: { id: string }) => p.id)).toEqual(['one', 'old'])
  expect(Object.keys(all.pins[0]).sort()).toEqual(['archived', 'createdAt', 'id', 'label', 'lastUsedAt', 'state', 'title', 'url'])
  expect(JSON.stringify(all)).not.toContain('data:image')
})

test('list_windows', async () => {
  expect(await run('list_windows')).toEqual({ windows: [{ id: 1, title: 'Win', url: 'https://w.example', focused: false, bounds: null, openedByYou: false, openedByAgent: false, canClose: false }] })
})

test('list_site_permissions lists the saved decisions', async () => {
  const r = await run('list_site_permissions')
  expect(r.permissions).toEqual([
    { origin: 'https://a.example', permission: 'media:video', decision: 'allow' },
    { origin: 'https://b.example', permission: 'geolocation', decision: 'deny' }
  ])
})

test('list_downloads is newest first and obeys the limit', async () => {
  const r = await run('list_downloads')
  expect(r.downloads.map((d: any) => d.filename)).toEqual(['f4.zip', 'f3.zip', 'f2.zip', 'f1.zip', 'f0.zip'])
  expect(r.downloads[0].startedAt).toBe('1970-01-01T00:00:04.000Z')
  expect((await run('list_downloads', { limit: 2 })).downloads).toHaveLength(2)
})

test('download addresses lose their query, fragment and sign-in, which can hold keys', async () => {
  const { withoutQuery } = await import('../../src/main/mcp/tools')
  expect(withoutQuery('https://user:pw@cdn.example/f.zip?X-Amz-Signature=abc&token=1#x')).toBe('https://cdn.example/f.zip')
  expect(withoutQuery('not a url')).toBe('')
})
