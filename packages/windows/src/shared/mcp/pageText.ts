/** Pure helpers for reading a page and taking a screenshot. No Electron here. */

export interface PageLink { text: string; href: string; index?: number }
export interface PageElement { index: number; tag: string; type?: string; label: string }

const MAX_LINKS = 200
const MAX_LINK_TEXT = 200

/** Tidy the page text, cut it to `max` characters and say whether it was cut. */
export function trimPageText(text: string, max: number): { text: string; truncated: boolean } {
  const tidy = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (tidy.length <= max) return { text: tidy, truncated: false }
  return { text: tidy.slice(0, max), truncated: true }
}

/** Keep only http and https links, once per address, with short text, at most 200. */
export function cleanLinks(raw: unknown): PageLink[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PageLink[] = []
  for (const item of raw) {
    if (out.length >= MAX_LINKS) break
    if (!item || typeof item !== 'object') continue
    const { text, href } = item as { text?: unknown; href?: unknown }
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href) || seen.has(href)) continue
    seen.add(href)
    const label = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, MAX_LINK_TEXT) : ''
    const index = (item as { index?: unknown }).index
    out.push(typeof index === 'number' && Number.isInteger(index) && index > 0 ? { text: label, href, index } : { text: label, href })
  }
  return out
}

/** The size to draw a picture at so its width is at most `max`, keeping the shape. */
export function fitWidth(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max || w <= 0) return { width: w, height: h }
  return { width: max, height: Math.max(1, Math.round((h * max) / w)) }
}

const MAX_ELEMENTS = 200
const MAX_LABEL = 80

/** The numbered interactive elements: at most 200, a short label each, never a value. */
export function cleanElements(raw: unknown): PageElement[] {
  if (!Array.isArray(raw)) return []
  const out: PageElement[] = []
  for (const item of raw) {
    if (out.length >= MAX_ELEMENTS) break
    if (!item || typeof item !== 'object') continue
    const { index, tag, type, label } = item as Record<string, unknown>
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || typeof tag !== 'string') continue
    const text = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL) : ''
    out.push({ index, tag: tag.slice(0, 20), ...(typeof type === 'string' && type ? { type: type.slice(0, 20) } : {}), label: text })
  }
  return out
}
