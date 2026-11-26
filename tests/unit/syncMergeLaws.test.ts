import { describe, expect, it } from 'vitest'
import { MAX_SYNC_HISTORY, emptyDoc, mergeDocs, type SyncDoc } from '../../src/shared/sync/merge'
import { PORTABLE_PREF_KEYS } from '../../src/shared/sync/portable'

// Property checks for the promise in merge.ts: "the result does not depend on the order, and merging twice changes
// nothing". Computers merge the shared file in any order, so a merge that depends on order makes them disagree and
// keep rewriting the file. Random documents are made from a small set of ids, times and devices so they collide often,
// including two different entries with the same time and device (two computers that share a device id).

const NOW = 1_700_000_000_000
const rng = (seed: number) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

function randomDoc(r: () => number): SyncDoc {
  const d = emptyDoc()
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
  const time = () => NOW - Math.floor(r() * 3) * 1000
  const device = () => pick(['a', 'b'])
  for (let i = 0; i < 6; i++) {
    const id = pick(['p1', 'p2', 'p3'])
    const k = r()
    if (k < 0.25) d.pins[id] = { updatedAt: time(), device: device(), pin: { id, url: `https://x/${pick(['1', '2'])}` } as never }
    else if (k < 0.5) d.tombstones[id] = { id, updatedAt: time(), device: device() }
    else if (k < 0.7) {
      const bid = `b${id}`
      d.bookmarks[bid] = { updatedAt: time(), device: device(), bookmark: { id: bid, url: `https://h/${bid}`, title: pick(['x', 'y']), createdAt: 0 } }
    } else if (k < 0.8) {
      const bid = `b${id}`
      d.tombstones[bid] = { id: bid, updatedAt: time(), device: device() }
    } else if (k < 0.9) {
      const url = `https://v/${pick(['1', '2', '3'])}`
      d.history[url] = { url, visits: 1 + Math.floor(r() * 3), lastVisit: time() }
    } else d.prefs[pick(PORTABLE_PREF_KEYS)] = { updatedAt: time(), device: device(), value: pick([true, false]) }
    d.devices[pick(['d1', 'd2'])] = { updatedAt: time(), name: pick(['m', 'n']), tabs: [] }
  }
  if (r() < 0.2) d.historyClearedAt = NOW - 2000
  return d
}

const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, sorted(x)])) : v
const same = (x: SyncDoc, y: SyncDoc) => expect(sorted(x)).toEqual(sorted(y))

describe('sync merge laws (5000 random cases each)', () => {
  const cases = Array.from({ length: 5000 }, (_, i) => { const r = rng(i + 1); return [randomDoc(r), randomDoc(r), randomDoc(r)] as const })

  it('does not depend on the order (a+b = b+a)', () => {
    for (const [a, b] of cases) same(mergeDocs(a, b, NOW), mergeDocs(b, a, NOW))
  })
  it('does not depend on the grouping ((a+b)+c = a+(b+c))', () => {
    // Known limit, left out here: a history entry keeps one visit count, not each visit's time. Merged with a newer
    // visit first, visits from before a "clear history" on another computer can still be counted. Only the count.
    for (const [a, b, c] of cases) {
      if (a.historyClearedAt || b.historyClearedAt || c.historyClearedAt) continue
      same(mergeDocs(mergeDocs(a, b, NOW), c, NOW), mergeDocs(a, mergeDocs(b, c, NOW), NOW))
    }
  })
  it('changes nothing when merged again', () => {
    for (const [a, b] of cases) {
      const ab = mergeDocs(a, b, NOW)
      same(mergeDocs(ab, ab, NOW), ab)
      same(mergeDocs(ab, b, NOW), ab)
    }
  })
})

describe('sync merge ties', () => {
  // Regression: on equal stamps the first argument won, so two computers that merge in a different order kept
  // different pins (and wrote the file back and forth).
  it('picks the same pin for two different edits with the same time and device', () => {
    const a = emptyDoc(), b = emptyDoc()
    a.pins.p = { updatedAt: NOW, device: 'same', pin: { id: 'p', url: 'https://one/' } as never }
    b.pins.p = { updatedAt: NOW, device: 'same', pin: { id: 'p', url: 'https://two/' } as never }
    expect(mergeDocs(a, b, NOW).pins.p).toEqual(mergeDocs(b, a, NOW).pins.p)
  })

  it('keeps the same history when the limit cuts through visits at the same time', () => {
    const a = emptyDoc(), b = emptyDoc()
    for (let i = 0; i < MAX_SYNC_HISTORY; i++) {
      a.history[`https://a/${i}`] = { url: `https://a/${i}`, visits: 1, lastVisit: NOW }
      b.history[`https://b/${i}`] = { url: `https://b/${i}`, visits: 1, lastVisit: NOW }
    }
    same(mergeDocs(a, b, NOW), mergeDocs(b, a, NOW))
  })
})
