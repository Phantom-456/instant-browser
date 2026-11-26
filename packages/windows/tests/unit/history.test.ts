import { describe, expect, test } from 'vitest'
import {
  buildHistory, chromiumTimeToMs, findHistory, matchesQuery, mergeHistory, recentPages, queryPages, recentSearches, searchTermFromUrl, type RawVisit
} from '../../src/shared/history'

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0)
const DAY = 24 * 3600 * 1000
const visit = (over: Partial<RawVisit>): RawVisit => ({
  url: 'https://example.com/', title: 'Example', visits: 1, lastVisit: NOW - DAY, source: 'Dia', ...over
})

describe('searchTermFromUrl', () => {
  test('reads the words from search pages of known engines', () => {
    expect(searchTermFromUrl('https://www.google.com/search?q=define+entropy&sei=x')).toBe('define entropy')
    expect(searchTermFromUrl('https://www.google.co.in/search?q=aws+lambda')).toBe('aws lambda')
    expect(searchTermFromUrl('https://duckduckgo.com/?q=rust%20book&t=h_')).toBe('rust book')
    expect(searchTermFromUrl('https://www.bing.com/search?q=cats')).toBe('cats')
    expect(searchTermFromUrl('https://search.brave.com/search?q=dogs&source=web')).toBe('dogs')
  })
  test('is null for other pages and bad input', () => {
    expect(searchTermFromUrl('https://example.com/?q=hello')).toBeNull()
    expect(searchTermFromUrl('https://www.google.com/maps?q=paris')).toBeNull()
    expect(searchTermFromUrl('https://www.google.com/search?q=')).toBeNull()
    expect(searchTermFromUrl('nonsense')).toBeNull()
  })
})

test('chromium time (microseconds since 1601) becomes milliseconds since 1970', () => {
  expect(chromiumTimeToMs(13_000_000_000_000_000)).toBe((13_000_000_000 - 11_644_473_600) * 1000)
})

test('history is built: searches grouped across browsers, search pages left out of the page list', () => {
  const h = buildHistory([
    visit({ url: 'https://www.google.com/search?q=define+entropy', title: 'define entropy - Google Search', source: 'Dia', visits: 2, lastVisit: NOW - 2 * DAY }),
    visit({ url: 'https://duckduckgo.com/?q=Define%20Entropy', source: 'Firefox', visits: 1, lastVisit: NOW - DAY }),
    visit({ url: 'https://docs.example.com/a#intro', title: 'Docs', source: 'Chrome', visits: 3 }),
    visit({ url: 'https://docs.example.com/a#other', title: '', source: 'Dia', visits: 2 }),
    visit({ url: 'file:///etc/hosts', title: 'hosts' }),
    visit({ url: 'chrome://settings', title: 'Settings' })
  ])
  expect(h.searches).toHaveLength(1)
  expect(h.searches[0]).toMatchObject({ term: 'define entropy', visits: 3, lastVisit: NOW - DAY })
  expect([...h.searches[0]!.sources].sort()).toEqual(['Dia', 'Firefox'])
  expect(h.pages).toHaveLength(1)
  expect(h.pages[0]).toMatchObject({ url: 'https://docs.example.com/a', title: 'Docs', visits: 5 })
})

test('matching needs every word, in any order, ignoring case', () => {
  expect(matchesQuery('AWS Lambda pricing', 'lambda aws')).toBe(true)
  expect(matchesQuery('AWS Lambda pricing', 'lambda s3')).toBe(false)
  expect(matchesQuery('x', '')).toBe(true)
})

test('recent items: frequent and recent first', () => {
  const h = buildHistory([
    visit({ url: 'https://www.google.com/search?q=old+topic', visits: 1, lastVisit: NOW - 200 * DAY }),
    visit({ url: 'https://www.google.com/search?q=new+topic', visits: 1, lastVisit: NOW - 1 * DAY }),
    visit({ url: 'https://www.google.com/search?q=often', visits: 30, lastVisit: NOW - 10 * DAY }),
    visit({ url: 'https://a.example/', title: 'A', visits: 1, lastVisit: NOW - 100 * DAY }),
    visit({ url: 'https://b.example/', title: 'B', visits: 9, lastVisit: NOW - 2 * DAY })
  ])
  expect(recentSearches(h, 2, NOW).map((s) => s.term)).toEqual(['new topic', 'often'])
  expect(recentPages(h, 1, NOW).map((p) => p.title)).toEqual(['B'])
})

test('find: matches words, prefix first', () => {
  const h = buildHistory([
    visit({ url: 'https://www.google.com/search?q=aws+lambda+limits', visits: 1, lastVisit: NOW - DAY }),
    visit({ url: 'https://www.google.com/search?q=how+to+aws', visits: 1, lastVisit: NOW - DAY }),
    visit({ url: 'https://aws.amazon.com/lambda/', title: 'AWS Lambda', visits: 4, lastVisit: NOW - DAY }),
    visit({ url: 'https://example.org/', title: 'Unrelated', visits: 4, lastVisit: NOW - DAY })
  ])
  const found = findHistory(h, 'aws', NOW, { searches: 5, pages: 5 })
  expect(found.searches.map((s) => s.term)).toEqual(['aws lambda limits', 'how to aws'])
  expect(found.pages.map((p) => p.title)).toEqual(['AWS Lambda'])
  expect(findHistory(h, 'zzz', NOW, { searches: 5, pages: 5 })).toEqual({ searches: [], pages: [] })
})

test('merging adds new entries and combines the same ones', () => {
  const a = buildHistory([
    visit({ url: 'https://www.google.com/search?q=cats', visits: 2, source: 'Dia', lastVisit: NOW - 2 * DAY }),
    visit({ url: 'https://a.example/', title: 'A', visits: 1, source: 'Dia', lastVisit: NOW - 2 * DAY })
  ])
  const b = buildHistory([
    visit({ url: 'https://www.google.com/search?q=cats', visits: 1, source: 'Instant Browser', lastVisit: NOW }),
    visit({ url: 'https://www.google.com/search?q=dogs', visits: 1, source: 'Instant Browser', lastVisit: NOW }),
    visit({ url: 'https://a.example/', title: '', visits: 1, source: 'Instant Browser', lastVisit: NOW })
  ])
  const m = mergeHistory(a, b)
  const cats = m.searches.find((s) => s.term === 'cats')!
  expect(cats).toMatchObject({ visits: 3, lastVisit: NOW })
  expect(cats.sources.sort()).toEqual(['Dia', 'Instant Browser'])
  expect(m.searches.map((s) => s.term).sort()).toEqual(['cats', 'dogs'])
  expect(m.pages[0]).toMatchObject({ title: 'A', visits: 2 }) // an empty title does not replace a real one
  expect(a.searches).toHaveLength(1) // the inputs are not changed
})

describe('queryPages', () => {
  const DAYMS = 24 * 3600 * 1000
  const now = Date.parse('2026-11-25T12:00:00Z')
  const rows = (): RawVisit[] => [
    // Dia last week and Chrome yesterday: the page's newest visit is yesterday, but not in Dia.
    { url: 'https://both.example/', title: 'Both', visits: 1, lastVisit: now - 7 * DAYMS, source: 'Dia' },
    { url: 'https://both.example/', title: 'Both', visits: 1, lastVisit: now - DAYMS, source: 'Chrome' },
    { url: 'https://dia-new.example/', title: 'Dia new', visits: 1, lastVisit: now - DAYMS / 2, source: 'Dia' },
    { url: 'https://old.example/', title: 'Old', visits: 1, lastVisit: now - 30 * DAYMS, source: 'Safari' }
  ]
  const yesterday = now - DAYMS

  test('time filters use the chosen browser\'s own last visit', () => {
    const h = buildHistory(rows())
    const dia = queryPages(h, { source: 'dia', since: yesterday, limit: 10 })
    expect(dia.pages.map((p) => p.url)).toEqual(['https://dia-new.example/'])
    const any = queryPages(h, { since: yesterday, limit: 10 })
    expect(any.pages.map((p) => p.url)).toEqual(['https://dia-new.example/', 'https://both.example/'])
    expect(queryPages(h, { source: 'Chrome', before: now - DAYMS / 2, limit: 10 }).pages.map((p) => p.url)).toEqual(['https://both.example/'])
  })

  test('keeps a last visit per browser through mergeHistory', () => {
    const h = mergeHistory(buildHistory(rows().slice(0, 1)), buildHistory(rows().slice(1, 2)))
    expect(h.pages[0]!.lastBySource).toEqual({ Dia: now - 7 * DAYMS, Chrome: now - DAYMS })
    expect(h.pages[0]!.lastVisit).toBe(now - DAYMS)
  })

  test('paging returns every page once, past 2,000, newest first', () => {
    const many: RawVisit[] = Array.from({ length: 2600 }, (_, i) => ({ url: `https://p${i}.example/`, title: `P${i}`, visits: 1, lastVisit: 1_000_000 + i, source: 'Dia' }))
    const h = buildHistory(many)
    const seen: string[] = []
    let offset: number | null = 0
    let total = 0
    while (offset !== null) {
      const r = queryPages(h, { offset, limit: 500 })
      total = r.total
      seen.push(...r.pages.map((p) => p.url))
      offset = r.nextOffset
    }
    expect(total).toBe(2600)
    expect(seen.length).toBe(2600)
    expect(new Set(seen).size).toBe(2600)
    expect(seen[0]).toBe('https://p2599.example/')
  })
})
