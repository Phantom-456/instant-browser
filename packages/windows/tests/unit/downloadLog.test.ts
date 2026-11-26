import { expect, test } from 'vitest'
import { DownloadLog, type DownloadItemLike } from '../../src/main/downloadLog'

function fake(name: string) {
  const handlers: Record<string, (e: unknown, state: string) => void> = {}
  const item = {
    received: 0, total: 100, path: '',
    getURL: () => `https://x.example/${name}`,
    getFilename: () => name,
    getSavePath: () => item.path,
    getReceivedBytes: () => item.received,
    getTotalBytes: () => item.total,
    on: (ev: string, fn: (e: unknown, state: string) => void) => { handlers[ev] = fn },
    once: (ev: string, fn: (e: unknown, state: string) => void) => { handlers[ev] = fn }
  }
  return { item: item as typeof item & DownloadItemLike, fire: (ev: string, state: string) => handlers[ev]!({}, state) }
}

test('keeps the last 200, newest first', () => {
  const log = new DownloadLog()
  for (let i = 0; i < 205; i++) log.track(fake(`f${i}`).item, i)
  const all = log.recent()
  expect(all).toHaveLength(200)
  expect(all[0]!.filename).toBe('f204')
  expect(all[199]!.filename).toBe('f5')
  expect(log.recent(3).map((e) => e.filename)).toEqual(['f204', 'f203', 'f202'])
})

test('updates the state as the download moves', () => {
  const log = new DownloadLog()
  const f = fake('a.zip')
  log.track(f.item, 5)
  expect(log.recent()[0]).toMatchObject({ state: 'progressing', startedAt: 5 })
  f.item.received = 40
  f.fire('updated', 'progressing')
  expect(log.recent()[0]!.receivedBytes).toBe(40)
  f.item.received = 100
  f.item.path = '/dl/a.zip'
  f.fire('done', 'completed')
  expect(log.recent()[0]).toMatchObject({ state: 'completed', receivedBytes: 100, savePath: '/dl/a.zip' })
  const g = fake('b.zip')
  log.track(g.item)
  g.fire('done', 'cancelled')
  expect(log.recent()[0]!.state).toBe('cancelled')
})
