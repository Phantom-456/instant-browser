/**
 * Bookmarks: one list of pages you want to keep, the same on every device. A bookmark is identified by its address, so
 * bookmarking the same page on two devices gives ONE bookmark, never two.
 */

export interface Bookmark {
  id: string
  url: string
  title: string
  createdAt: number
  /** Keep this bookmark on this computer only: it is not synced. Never sent anywhere. */
  syncOff?: boolean
}

export const MAX_BOOKMARKS = 5000

/** Only web pages can be bookmarked. The address is cleaned a little so the same page always gives the same id. */
export function normalizeBookmarkUrl(input: string): string | null {
  let url: URL
  try { url = new URL(input.trim()) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = '' // a bookmark is for the page, not for a spot in it
  const text = url.toString()
  return text.length <= 4096 ? text : null
}

/** A short fixed name from an address (FNV-1a, twice with different seeds: 16 characters). */
export function bookmarkId(url: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
    return h.toString(16).padStart(8, '0')
  }
  return `bm-${fnv(2166136261)}${fnv(0x9747b28c)}`
}

export function makeBookmark(url: string, title: string, now: number): Bookmark | null {
  const clean = normalizeBookmarkUrl(url)
  if (!clean) return null
  return { id: bookmarkId(clean), url: clean, title: title.trim().slice(0, 300) || hostOf(clean), createdAt: now }
}

export function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return url }
}

/** Read what is saved on disk or comes from another device. Anything that does not fit is dropped. */
export function parseBookmark(raw: unknown): Bookmark | null {
  const r = raw as Partial<Bookmark> | null
  if (!r || typeof r !== 'object' || typeof r.url !== 'string') return null
  const clean = normalizeBookmarkUrl(r.url)
  if (!clean) return null
  return {
    id: bookmarkId(clean), // the id is always made from the address
    url: clean,
    title: typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 300) : hostOf(clean),
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0,
    ...(r.syncOff === true ? { syncOff: true } : {})
  }
}

/** Newest first. Equal times (two bookmarks in the same millisecond, or old ones with no time) are ordered by id, so the
 * order does not depend on the order they were added or read from the file. */
export function newestFirst(a: Bookmark, b: Bookmark): number {
  return (b.createdAt - a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Bookmarks that match what was typed (every word must be in the title or the address). Newest first. */
export function matchBookmarks(list: Bookmark[], text: string, limit = 6): Bookmark[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  const sorted = [...list].sort(newestFirst)
  if (words.length === 0) return sorted.slice(0, limit)
  return sorted.filter((b) => { const pool = `${b.title} ${b.url}`.toLowerCase(); return words.every((w) => pool.includes(w)) }).slice(0, limit)
}
