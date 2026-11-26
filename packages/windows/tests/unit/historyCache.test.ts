import { expect, test } from 'vitest'
import { planScan, sameSignature, settleReads, type CachedFile } from '../../src/shared/historyCache'
import { buildHistory, capHistory, type RawVisit } from '../../src/shared/history'

const NOW = Date.UTC(2026, 10, 15)
const row = (url: string, lastVisit = NOW, visits = 1): RawVisit => ({ url, title: 't', visits, lastVisit, source: 'Dia' })
const cached = (path: string, size: number, mtimeMs: number): CachedFile => ({
  path, source: 'Dia', sig: { size, mtimeMs }, rows: [row(`https://${path}.example/`)]
})

test('signatures are equal only when size and time are equal', () => {
  expect(sameSignature({ size: 1, mtimeMs: 2 }, { size: 1, mtimeMs: 2 })).toBe(true)
  expect(sameSignature({ size: 1, mtimeMs: 2 }, { size: 1, mtimeMs: 3 })).toBe(false)
  expect(sameSignature({ size: 1, mtimeMs: 2 }, { size: 9, mtimeMs: 2 })).toBe(false)
  expect(sameSignature(undefined, { size: 1, mtimeMs: 2 })).toBe(false)
})

test('only files that changed or are new are read again; unchanged files come from the cache', () => {
  const files = [
    { path: 'a', source: 'Dia', sig: { size: 10, mtimeMs: 100 } }, // same as cache
    { path: 'b', source: 'Dia', sig: { size: 20, mtimeMs: 250 } }, // changed
    { path: 'c', source: 'Arc', sig: { size: 5, mtimeMs: 1 } } // new
  ]
  const plan = planScan(files, [cached('a', 10, 100), cached('b', 20, 200), cached('gone', 1, 1)])
  expect(plan.reuse.map((f) => f.path)).toEqual(['a'])
  expect(plan.read.map((f) => f.path)).toEqual(['b', 'c'])
})

test('nothing changed: nothing is read', () => {
  const plan = planScan([{ path: 'a', source: 'Dia', sig: { size: 10, mtimeMs: 100 } }], [cached('a', 10, 100)])
  expect(plan.read).toEqual([])
})

test('the history is capped, keeping the newest entries', () => {
  const rows: RawVisit[] = []
  for (let i = 0; i < 50; i++) rows.push(row(`https://www.google.com/search?q=term+${i}`, NOW - i * 1000))
  for (let i = 0; i < 50; i++) rows.push(row(`https://site${i}.example/`, NOW - i * 1000))
  const small = capHistory(buildHistory(rows), 10, 20, NOW)
  expect(small.searches).toHaveLength(10)
  expect(small.pages).toHaveLength(20)
  expect(small.searches.map((s) => s.term)).toContain('term 0')
  expect(small.searches.map((s) => s.term)).not.toContain('term 49')
})

// Regression: a history file that could not be read (the browser was writing it) was saved as "no rows" under its new
// size and time. That browser then vanished from the search bar until it wrote to its history again.
test('a file that could not be read keeps its old rows and is tried again next time', () => {
  const old = cached('a', 10, 100)
  const changed = { path: 'a', source: 'Dia', sig: { size: 11, mtimeMs: 200 } }
  const kept = settleReads([{ file: changed, rows: null }], [old])
  expect(kept).toEqual([old]) // old rows, old signature
  expect(planScan([changed], kept).read.map((f) => f.path)).toEqual(['a']) // so it is read again
})

test('a new file that could not be read is not cached at all; a read file is cached with its new signature', () => {
  const file = { path: 'n', source: 'Dia', sig: { size: 1, mtimeMs: 1 } }
  expect(settleReads([{ file, rows: null }], [])).toEqual([])
  expect(settleReads([{ file, rows: [] }], [cached('n', 0, 0)])).toEqual([{ ...file, rows: [] }]) // really empty is kept
})
