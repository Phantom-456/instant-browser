import { expect, test } from 'vitest'
import { browserTools } from '../../src/main/mcp/tools'
import type { PinRecord } from '../../src/shared/pins/model'

const pin = (id: string, archived: boolean): PinRecord => ({
  id, url: `https://${id}.example/`, title: id, label: null, syncOff: false, icon: 'data:image/png;base64,AAAA', state: 'resident', archived,
  archivedAt: null, following: false, gradient: {} as PinRecord['gradient'], window: { x: 0, y: 0, width: 1, height: 1 }, anchor: null,
  pin: { x: 0, y: 0 }, scroll: null, snapshotAt: 5, createdAt: 1000, lastUsedAt: 2000, restoredAt: null
})
let tabsOn = true
const tools = browserTools({
  bookmarks: () => [
    { id: 'a', title: 'Rust book', url: 'https://doc.rust-lang.org/book', createdAt: 0 },
    { id: 'b', title: 'Cooking', url: 'https://food.example/rust-stew', createdAt: 1000 },
    { id: 'c', title: 'News', url: 'https://news.example', createdAt: 2000 }
  ],
  browserMarks: () => [
    { title: 'Mail', url: 'https://mail.example', folders: [['Bookmarks bar']], sources: ['Google Chrome'], addedAt: 0 },
    { title: 'Maps', url: 'https://maps.example', folders: [['Bookmarks bar', 'Work'], ['Other bookmarks', 'Trips']], sources: ['Google Chrome', 'Dia'], addedAt: 86_400_000 },
    { title: 'Docs', url: 'https://docs.example', folders: [['Bookmarks bar', 'Work', 'Specs']], sources: ['Dia'], addedAt: 0 }
  ],
  history: (f) => { const pages = Array.from({ length: 3 }, (_, i) => ({ url: `https://h${i}.example`, title: `Page ${i}`, visits: i + 1, lastVisit: 0, sources: ['Talaria'] })).filter((p) => !f.query || p.title.toLowerCase().includes(f.query.toLowerCase())); return { total: pages.length, pages: pages.slice(f.offset ?? 0, (f.offset ?? 0) + f.limit), nextOffset: null } },
  pins: () => [pin('one', false)],
  archivedPins: () => [pin('old', true)],
  windows: () => [{ id: 1, title: 'Win', url: 'https://w.example' }],
  tabs: () => ({ on: tabsOn, tabs: [{ browser: 'Safari', title: 'Inbox', url: 'https://mail.example' }, { browser: 'Arc', title: 'Docs', url: 'https://docs.example' }] }),
  sitePermissions: () => [{ origin: 'https://a.example', permission: 'media:video', decision: 'allow' }, { origin: 'https://b.example', permission: 'geolocation', decision: 'deny' }],
  downloads: (limit) => Array.from({ length: Math.min(limit, 5) }, (_, i) => ({ url: `https://d.example/${i}`, filename: `f${i}.zip`, savePath: `/dl/f${i}.zip`, state: 'completed', receivedBytes: 10, totalBytes: 10, startedAt: 1000 * i })).reverse()
})
const run = async (name: string, args: Record<string, unknown> = {}) => (await tools.find((t) => t.name === name)!.run(args, { client: 't', agentId: 'ag-000000000001' })) as any

test('every tool is read-only and has a strict object schema', () => {
  expect(tools.map((t) => t.name)).toEqual(['list_bookmarks', 'list_browser_bookmarks', 'list_browser_bookmark_folders', 'list_history', 'list_pins', 'list_windows', 'list_browser_tabs', 'list_site_permissions', 'list_downloads'])
  for (const t of tools) expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
  for (const t of tools) expect(t.description.toLowerCase()).toContain('read-only')
})

test('list_bookmarks filters by every word, in title or address', async () => {
  const r = await run('list_bookmarks', { query: 'RUST book' })
  expect(r.total).toBe(1)
  expect(r.bookmarks[0]).toEqual({ id: 'a', title: 'Rust book', url: 'https://doc.rust-lang.org/book', createdAt: '1970-01-01T00:00:00.000Z' })
  expect((await run('list_bookmarks', { query: 'rust' })).total).toBe(2)
  const limited = await run('list_bookmarks', { limit: 1 })
  expect(limited.bookmarks).toHaveLength(1)
  expect(limited.total).toBe(3)
})

test('arguments are checked', async () => {
  await expect(run('list_bookmarks', { limit: 0 })).rejects.toThrow('between')
  await expect(run('list_bookmarks', { query: 5 })).rejects.toThrow('text')
})

test('list_browser_bookmarks and list_history', async () => {
  expect((await run('list_browser_bookmarks', { query: 'map' })).bookmarks).toEqual([{ title: 'Maps', url: 'https://maps.example', folders: ['Bookmarks bar/Work', 'Other bookmarks/Trips'], sources: ['Google Chrome', 'Dia'], addedAt: '1970-01-02T00:00:00.000Z' }])
  const h = await run('list_history', { query: 'page 1' })
  expect(h.pages).toEqual([{ url: 'https://h1.example', title: 'Page 1', visits: 2, lastVisit: '1970-01-01T00:00:00.000Z', sources: ['Talaria'], lastVisitBySource: { Talaria: '1970-01-01T00:00:00.000Z' } }])
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

test('list_browser_tabs is empty with a note while listing tabs is off', async () => {
  tabsOn = false
  const r = await run('list_browser_tabs')
  tabsOn = true
  expect(r.tabs).toEqual([])
  expect(r.note).toContain('Settings > Your browsers')
})

test('list_browser_tabs filters by query', async () => {
  const r = await run('list_browser_tabs', { query: 'inbox' })
  expect(r.total).toBe(1)
  expect(r.tabs).toEqual([{ browser: 'Safari', title: 'Inbox', url: 'https://mail.example' }])
  expect((await run('list_browser_tabs')).tabs).toHaveLength(2)
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

test('list_browser_bookmarks filters by folder prefix and browser, and a bookmark in 2 folders shows both', async () => {
  const work = await run('list_browser_bookmarks', { folder: 'bookmarks BAR/work' })
  expect(work.bookmarks.map((b: any) => b.title)).toEqual(['Maps', 'Docs'])
  expect(work.total).toBe(2)
  expect((await run('list_browser_bookmarks', { folder: 'Other bookmarks' })).bookmarks[0].folders).toEqual(['Bookmarks bar/Work', 'Other bookmarks/Trips'])
  expect((await run('list_browser_bookmarks', { source: 'dia' })).bookmarks.map((b: any) => b.title)).toEqual(['Maps', 'Docs'])
  expect((await run('list_browser_bookmarks', { source: 'Dia', folder: 'Bookmarks bar/Work/Specs' })).bookmarks.map((b: any) => b.title)).toEqual(['Docs'])
  expect((await run('list_browser_bookmarks', { source: 'Safari' })).total).toBe(0)
})

test('list_browser_bookmarks pages with offset and nextOffset', async () => {
  const first = await run('list_browser_bookmarks', { limit: 2 })
  expect(first.nextOffset).toBe(2)
  const second = await run('list_browser_bookmarks', { limit: 2, offset: first.nextOffset })
  expect(second.nextOffset).toBeNull()
  expect([...first.bookmarks, ...second.bookmarks].map((b: any) => b.title)).toEqual(['Mail', 'Maps', 'Docs'])
})

test('list_browser_bookmark_folders gives paths with counts', async () => {
  const r = await run('list_browser_bookmark_folders')
  expect(r.folders).toEqual([
    { path: 'Bookmarks bar', count: 3 },
    { path: 'Bookmarks bar/Work', count: 2 },
    { path: 'Bookmarks bar/Work/Specs', count: 1 },
    { path: 'Other bookmarks', count: 1 },
    { path: 'Other bookmarks/Trips', count: 1 }
  ])
  expect(r.sources).toEqual(['Dia', 'Google Chrome'])
})
