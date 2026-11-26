import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BookmarkStore } from '../../src/main/bookmarkStore'
import { OwnHistory } from '../../src/main/ownHistory'
import { bookmarkId, makeBookmark, matchBookmarks, normalizeBookmarkUrl, parseBookmark } from '../../src/shared/bookmarks'
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/shared/settings'

describe('bookmark addresses', () => {
  it('only web pages, and the same page always gives the same id', () => {
    expect(normalizeBookmarkUrl('https://example.com/a#section')).toBe('https://example.com/a')
    expect(normalizeBookmarkUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeBookmarkUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeBookmarkUrl('not a url')).toBeNull()
    expect(bookmarkId('https://example.com/a')).toBe(bookmarkId('https://example.com/a'))
    expect(bookmarkId('https://example.com/a')).not.toBe(bookmarkId('https://example.com/b'))
    expect(bookmarkId('https://example.com/a')).toMatch(/^bm-[0-9a-f]{16}$/)
  })

  it('a title falls back to the site, and what is read from outside is cleaned', () => {
    expect(makeBookmark('https://www.example.com/x', '   ', 5)!.title).toBe('example.com')
    expect(parseBookmark({ id: 'forged', url: 'https://a.com/', title: 'T', createdAt: 1 })!.id).toBe(bookmarkId('https://a.com/')) // the id is always made from the address
    expect(parseBookmark({ url: 'ftp://a.com/' })).toBeNull()
    expect(parseBookmark(null)).toBeNull()
  })

  it('finds bookmarks by every word, newest first', () => {
    const list = [makeBookmark('https://aws.amazon.com/lambda', 'AWS Lambda', 1)!, makeBookmark('https://example.com/cats', 'Cats', 2)!]
    expect(matchBookmarks(list, 'lambda aws').map((b) => b.title)).toEqual(['AWS Lambda'])
    expect(matchBookmarks(list, '').map((b) => b.title)).toEqual(['Cats', 'AWS Lambda'])
    expect(matchBookmarks(list, 'zzz')).toEqual([])
  })
})

describe('the bookmark file', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'ib-bm-')), 'bookmarks.json')

  it('the star adds a bookmark and removes it again; the file is private and survives a restart', () => {
    const path = file()
    const store = new BookmarkStore(path, () => 1000)
    expect(store.toggle('https://example.com/a', 'Page A')).toBe('added')
    expect(store.has('https://example.com/a#x')).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(process.platform === 'win32' ? statSync(path).mode & 0o777 : 0o600)
    expect(new BookmarkStore(path).list().map((b) => b.title)).toEqual(['Page A'])
    expect(store.toggle('https://example.com/a', 'Page A')).toBe('removed')
    expect(store.has('https://example.com/a')).toBe(false)
    expect(store.toggle('javascript:1', 'x')).toBe('invalid')
  })

  it('add keeps an existing bookmark (it does not toggle it off) and refuses a bad address', () => {
    const store = new BookmarkStore(file())
    expect(store.add('https://example.com/a', 'First')).toBe('added')
    expect(store.add('https://example.com/a#x', 'Second')).toBe('exists')
    expect(store.list().map((b) => b.title)).toEqual(['First'])
    expect(store.add('javascript:1', 'x')).toBe('invalid')
    expect(store.list()).toHaveLength(1)
  })

  it('tells sync when a bookmark is removed here, but not when sync removes it', () => {
    const store = new BookmarkStore(file())
    const removed: string[] = []
    store.onRemoved = (id) => removed.push(id)
    store.toggle('https://example.com/a', 'A')
    store.toggle('https://example.com/b', 'B')
    store.remove(bookmarkId('https://example.com/a'))
    store.drop(bookmarkId('https://example.com/b')) // from sync
    expect(removed).toEqual([bookmarkId('https://example.com/a')])
    expect(store.list()).toEqual([])
  })

  it('takes bookmarks from sync, and does not trust a broken file', () => {
    const path = file()
    writeFileSync(path, '{ broken')
    const store = new BookmarkStore(path)
    expect(store.list()).toEqual([])
    store.take({ id: 'x', url: 'https://example.com/from-pc', title: 'From the PC', createdAt: 9 })
    store.take({ id: 'y', url: 'javascript:1', title: 'bad', createdAt: 9 })
    expect(store.list().map((b) => b.url)).toEqual(['https://example.com/from-pc'])
    expect(JSON.parse(readFileSync(path, 'utf8')).items).toHaveLength(1)
  })

  it('removing one bookmark does not tell sync about the page again on a repeated remove', () => {
    const store = new BookmarkStore(file())
    let n = 0
    store.onRemoved = () => n++
    store.toggle('https://example.com/a', 'A')
    store.remove(bookmarkId('https://example.com/a'))
    store.remove(bookmarkId('https://example.com/a'))
    expect(n).toBe(1)
  })
})

describe('the app history and sync', () => {
  const path = () => join(mkdtempSync(join(tmpdir(), 'ib-hist-')), 'history.json')

  it('takes over what other computers visited, keeping the highest count and the newest visit', () => {
    const h = new OwnHistory(path())
    h.record('https://x.com/', 100)
    h.record('https://x.com/', 200)
    h.mergeIn([{ url: 'https://x.com/', visits: 1, lastVisit: 900 }, { url: 'https://y.com/', visits: 4, lastVisit: 50 }], 0)
    const byUrl = Object.fromEntries(h.items().map((i) => [i.url, i]))
    expect(byUrl['https://x.com/']).toEqual({ url: 'https://x.com/', visits: 2, lastVisit: 900 })
    expect(byUrl['https://y.com/']!.visits).toBe(4)
  })

  it('forgets what is older than the last clear, here and from other computers, and tells sync when it is cleared here', () => {
    const h = new OwnHistory(path())
    let cleared = 0
    h.onClear = (t) => { cleared = t }
    h.record('https://old.com/', 100)
    h.mergeIn([{ url: 'https://other.com/', visits: 1, lastVisit: 150 }, { url: 'https://new.com/', visits: 1, lastVisit: 500 }], 300)
    expect(h.items().map((i) => i.url)).toEqual(['https://new.com/'])
    h.clear(777)
    expect(cleared).toBe(777)
    expect(h.items()).toEqual([])
  })
})

describe('the sync switches', () => {
  it('bookmarks start on; history and open pages start off; they belong to this computer', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ syncBookmarks: true, syncHistory: false, syncOpenPages: false, deviceName: '' })
    expect(mergeSettings({ deviceName: '  Work   Mac  ' }).deviceName).toBe('Work Mac')
    expect(mergeSettings({ deviceName: 'x'.repeat(100) }).deviceName).toHaveLength(40)
    expect(mergeSettings({ syncHistory: 'yes' }).syncHistory).toBe(false)
  })
})

// Regression: removing a "this computer only" bookmark sent a tombstone, which deleted the same page's bookmark on the
// other computers (and told them the page had been bookmarked here).
describe('bookmarks kept on this computer only', () => {
  it('are removed (or moved to a new address) without telling sync', () => {
    const store = new BookmarkStore(join(mkdtempSync(join(tmpdir(), 'bm-')), 'bookmarks.json'), () => 1000)
    const told: string[] = []
    store.onRemoved = (id) => told.push(id)
    store.toggle('https://local.test/', 'Local')
    store.toggle('https://shared.test/', 'Shared')
    const local = store.list().find((b) => b.url === 'https://local.test/')!
    const shared = store.list().find((b) => b.url === 'https://shared.test/')!
    store.setSyncOff(local.id, true)
    store.edit(local.id, 'Local', 'https://local.test/moved')
    store.remove(bookmarkId('https://local.test/moved'))
    expect(told).toEqual([])
    store.remove(shared.id)
    expect(told).toEqual([shared.id])
  })
})

describe('bookmarks made in the same millisecond (bug hunt 12)', () => {
  it('are listed in the same order whichever was added first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ib-bm-tie-'))
    const one = new BookmarkStore(join(dir, 'a.json'), () => 5000)
    one.toggle('https://zebra.example.com/', 'Zebra'); one.toggle('https://apple.example.com/', 'Apple')
    const two = new BookmarkStore(join(dir, 'b.json'), () => 5000)
    two.toggle('https://apple.example.com/', 'Apple'); two.toggle('https://zebra.example.com/', 'Zebra')
    expect(one.list().map((b) => b.title)).toEqual(two.list().map((b) => b.title))
    expect(one.search('').map((b) => b.title)).toEqual(two.search('').map((b) => b.title))
  })

  it('a newer bookmark still comes first', () => {
    const z = makeBookmark('https://zebra.example.com/', 'Zebra', 1)!
    const a = makeBookmark('https://apple.example.com/', 'Apple', 2)!
    expect(matchBookmarks([z, a], '').map((b) => b.title)).toEqual(['Apple', 'Zebra'])
  })
})
