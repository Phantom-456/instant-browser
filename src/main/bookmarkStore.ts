import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MAX_BOOKMARKS, hostOf, makeBookmark, matchBookmarks, newestFirst, normalizeBookmarkUrl, parseBookmark, bookmarkId, type Bookmark } from '../shared/bookmarks'

/**
 * The bookmarks, saved on this computer (`bookmarks.json`, readable only by you). One list for the whole account: with sync on,
 * it is the same on every computer. A bookmark is made from the page's address, so the same page is never twice in the list.
 */
export class BookmarkStore {
  private items = new Map<string, Bookmark>()
  /** Something changed (the search bar, the manager and sync listen). */
  onChange: (() => void) | null = null
  /** A synced bookmark was removed here (sync tells the other computers). Not called for "this computer only" bookmarks. */
  onRemoved: ((id: string) => void) | null = null

  constructor(private readonly path: string, private readonly now: () => number = Date.now) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { items?: unknown[] }
      for (const item of Array.isArray(raw.items) ? raw.items : []) {
        const b = parseBookmark(item)
        if (b) this.items.set(b.id, b)
      }
    } catch { /* no file yet, or a broken one: start empty (a broken file is not trusted) */ }
  }

  list(): Bookmark[] { return [...this.items.values()].sort(newestFirst) }
  has(url: string): boolean { const u = normalizeBookmarkUrl(url); return !!u && this.items.has(bookmarkId(u)) }
  search(text: string, limit = 6): Bookmark[] { return matchBookmarks(this.list(), text, limit) }

  /** The star: bookmark the page, or remove its bookmark. */
  toggle(url: string, title: string): 'added' | 'removed' | 'invalid' {
    const bookmark = makeBookmark(url, title, this.now())
    if (!bookmark) return 'invalid'
    if (this.items.has(bookmark.id)) { this.remove(bookmark.id); return 'removed' }
    if (this.items.size >= MAX_BOOKMARKS) return 'invalid'
    this.items.set(bookmark.id, bookmark)
    this.save()
    return 'added'
  }

  /** Bookmark the page, and keep an existing bookmark as it is (unlike the star, which toggles). */
  add(url: string, title: string): 'added' | 'exists' | 'invalid' {
    const bookmark = makeBookmark(url, title, this.now())
    if (!bookmark) return 'invalid'
    if (this.items.has(bookmark.id)) return 'exists'
    if (this.items.size >= MAX_BOOKMARKS) return 'invalid'
    this.items.set(bookmark.id, bookmark)
    this.save()
    return 'added'
  }

  remove(id: string): void {
    const old = this.items.get(id)
    if (!old) return
    this.items.delete(id)
    this.save()
    // A bookmark kept on this computer only was never sent, so its removal is not sent either. Its id is made from the
    // address, so a tombstone would also delete the same page's bookmark on the other computers.
    if (!old.syncOff) this.onRemoved?.(id)
  }

  /** Edit a bookmark: its title and its address. A new address is a different page, so it is a new bookmark (the old one is removed). */
  edit(id: string, title: string, url: string): 'ok' | 'invalid' | 'exists' {
    const old = this.items.get(id)
    if (!old) return 'invalid'
    const clean = normalizeBookmarkUrl(url)
    if (!clean) return 'invalid'
    const cleanTitle = title.trim().slice(0, 300) || hostOf(clean)
    const newId = bookmarkId(clean)
    if (newId === id) {
      this.items.set(id, { ...old, title: cleanTitle })
      this.save()
      return 'ok'
    }
    if (this.items.has(newId)) return 'exists' // that page is bookmarked already
    this.items.delete(id)
    this.items.set(newId, { id: newId, url: clean, title: cleanTitle, createdAt: old.createdAt, ...(old.syncOff ? { syncOff: true } : {}) })
    this.save()
    if (!old.syncOff) this.onRemoved?.(id) // the old address is gone on the other computers too (unless it was never sent)
    return 'ok'
  }

  /** Keep a bookmark on this computer only (or sync it again). */
  setSyncOff(id: string, off: boolean): void {
    const b = this.items.get(id)
    if (!b || (b.syncOff === true) === off) return
    this.items.set(id, off ? { ...b, syncOff: true } : (({ syncOff: _s, ...rest }) => rest)(b))
    this.save()
  }

  /** From sync: add or change a bookmark that came from another computer (this does not tell sync again). */
  take(bookmark: Bookmark): void {
    const clean = parseBookmark(bookmark)
    if (!clean || this.items.size >= MAX_BOOKMARKS) return
    const mine = this.items.get(clean.id)
    this.items.set(clean.id, mine?.syncOff ? { ...clean, syncOff: true } : clean)
    this.save()
  }

  /** From sync: a bookmark that was removed on another computer. */
  drop(id: string): void {
    if (this.items.delete(id)) this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, items: this.list() }), { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, this.path)
    this.onChange?.()
  }
}
