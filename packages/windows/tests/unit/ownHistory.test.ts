import { expect, test } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OwnHistory } from '../../src/main/ownHistory'

const file = () => join(mkdtempSync(join(tmpdir(), 'ib-own-')), 'history.json')

test('opened addresses are counted, saved, and found again after a restart', () => {
  const path = file()
  const h = new OwnHistory(path)
  h.record('https://example.com/a', 1000)
  h.record('https://example.com/a', 2000)
  h.record('https://www.google.com/search?q=cats', 3000)
  expect(h.rows().map((r) => [r.url, r.visits, r.source])).toEqual([
    ['https://www.google.com/search?q=cats', 1, 'Instant Browser'],
    ['https://example.com/a', 2, 'Instant Browser']
  ])
  expect(new OwnHistory(path).rows()).toHaveLength(2)
})
test('it keeps only the 500 newest, and can be cleared', () => {
  const path = file()
  const h = new OwnHistory(path)
  for (let i = 0; i < 520; i++) h.record(`https://example.com/${i}`, i)
  expect(h.rows()).toHaveLength(500)
  expect(h.rows()[0]?.url).toBe('https://example.com/519')
  h.clear()
  expect(h.rows()).toEqual([])
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([])
}, 30_000) // 520 saves, each flushed to disk (atomicWrite): over 5 s on the Windows CI runner
test('a broken file starts empty', () => {
  const path = file()
  writeFileSync(path, '{not json')
  expect(new OwnHistory(path).rows()).toEqual([])
})
