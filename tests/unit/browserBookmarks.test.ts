import { describe, expect, it } from 'vitest'
import { buildFolderTree, matchMergedMarks, mergeMarks, parseChromiumBookmarks, parseFirefoxBookmarks, type FirefoxRow } from '../../src/shared/browserBookmarks'

const chromium = JSON.stringify({
  roots: {
    bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
      { type: 'url', name: 'Docs', url: 'https://docs.example.com/a#top', date_added: '13300000000000000' },
      { type: 'folder', name: 'Work', children: [{ type: 'url', name: 'Wiki', url: 'https://wiki.example.com/' }] }
    ] },
    other: { type: 'folder', name: 'Other bookmarks', children: [{ type: 'url', name: '', url: 'javascript:alert(1)' }] }
  }
})

describe('browser bookmarks', () => {
  it('reads a Chromium file with its folders and dates', () => {
    const marks = parseChromiumBookmarks(chromium, 'Google Chrome')
    expect(marks.map((m) => [m.title, m.folder.join('/')])).toEqual([['Docs', 'Bookmarks bar'], ['Wiki', 'Bookmarks bar/Work'], ['', 'Other bookmarks']])
    expect(marks[0]!.addedAt).toBeGreaterThan(1_600_000_000_000) // a real date in 2020s, not 1601
    expect(parseChromiumBookmarks('not json', 'x')).toEqual([])
  })

  it('reads Firefox rows and names the top folders', () => {
    const rows: FirefoxRow[] = [
      { id: 1, type: 2, parent: 0, title: '', url: null, dateAdded: null, guid: 'root________' },
      { id: 2, type: 2, parent: 1, title: 'toolbar', url: null, dateAdded: null, guid: 'toolbar_____' },
      { id: 7, type: 2, parent: 2, title: 'Reading', url: null, dateAdded: null, guid: 'abc' },
      { id: 8, type: 1, parent: 7, title: 'Article', url: 'https://news.example.com/x', dateAdded: 1_700_000_000_000_000, guid: 'def' }
    ]
    const [m] = parseFirefoxBookmarks(rows, 'Firefox')
    expect(m).toMatchObject({ title: 'Article', folder: ['Bookmarks bar', 'Reading'], source: 'Firefox', addedAt: 1_700_000_000_000 })
  })

  // Regression: Firefox keeps each tag as a folder under its tags root, with a second row for every tagged page. Those
  // rows were read as bookmarks, so a tagged page showed again in a made-up "tags/<tag>" folder.
  it('leaves out Firefox tags (they are not bookmarks)', () => {
    const rows: FirefoxRow[] = [
      { id: 1, type: 2, parent: 0, title: '', url: null, dateAdded: null, guid: 'root________' },
      { id: 2, type: 2, parent: 1, title: 'toolbar', url: null, dateAdded: null, guid: 'toolbar_____' },
      { id: 4, type: 2, parent: 1, title: 'tags', url: null, dateAdded: null, guid: 'tags________' },
      { id: 9, type: 2, parent: 4, title: 'news', url: null, dateAdded: null, guid: 'tag1' },
      { id: 8, type: 1, parent: 2, title: 'Article', url: 'https://news.example.com/x', dateAdded: 1, guid: 'def' },
      { id: 10, type: 1, parent: 9, title: null, url: 'https://news.example.com/x', dateAdded: 2, guid: 'ghi' }
    ]
    expect(parseFirefoxBookmarks(rows, 'Firefox').map((m) => m.folder)).toEqual([['Bookmarks bar']])
  })

  it('merges by address: one entry, every folder and every browser, only web pages', () => {
    const merged = mergeMarks([
      ...parseChromiumBookmarks(chromium, 'Google Chrome'),
      { url: 'https://docs.example.com/a', title: 'Docs (Firefox)', folder: ['Bookmarks bar', 'Reading'], source: 'Firefox', addedAt: 5 }
    ])
    expect(merged).toHaveLength(2) // javascript: dropped; the two Docs are one
    const docs = merged.find((m) => m.url === 'https://docs.example.com/a')!
    expect(docs.sources).toEqual(['Google Chrome', 'Firefox'])
    expect(docs.folders).toEqual([['Bookmarks bar'], ['Bookmarks bar', 'Reading']])
    expect(docs.title).toBe('Docs')
    expect(docs.addedAt).toBe(5) // the earliest
  })

  it('builds one folder tree: the same folder in two browsers is one folder', () => {
    const merged = mergeMarks([
      { url: 'https://a.example.com/', title: 'A', folder: ['Bookmarks bar', 'Work'], source: 'Chrome', addedAt: 1 },
      { url: 'https://b.example.com/', title: 'B', folder: ['Bookmarks bar', 'Work'], source: 'Firefox', addedAt: 2 }
    ])
    const tree = buildFolderTree(merged)
    expect(tree.folders).toHaveLength(1)
    expect(tree.folders[0]!.folders[0]!.marks.map((m) => m.title).sort()).toEqual(['A', 'B'])
  })

  it('finds bookmarks by every word', () => {
    const merged = mergeMarks([{ url: 'https://wiki.example.com/', title: 'Team wiki', folder: [], source: 'Chrome', addedAt: 1 }])
    expect(matchMergedMarks(merged, 'team wiki')).toHaveLength(1)
    expect(matchMergedMarks(merged, 'team pizza')).toHaveLength(0)
  })
})
