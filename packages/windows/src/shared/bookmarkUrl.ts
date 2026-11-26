/**
 * Address helpers for agent folders. Windows has no store of the person's own bookmarks; these are the small pieces
 * of the Mac bookmark code that agent folders need (copied in, not shared).
 */

/** Only web pages can be saved. The address is cleaned a little so the same page always gives the same id. */
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

export function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return url }
}
