/**
 * Bookmarks from the other browsers on this computer: read, merged by address, and kept as one folder tree.
 * Only bookmark files are read. Cookies and passwords are never read. Nothing here writes to a browser.
 */
import { CHROMIUM_EPOCH_MS } from './history'
import { normalizeBookmarkUrl } from './bookmarks'

/** One bookmark as one browser holds it. */
export interface BrowserMark {
  url: string
  title: string
  /** The folders it sits in, from the top: ['Bookmarks bar', 'Work']. */
  folder: string[]
  /** The browser it came from, for example "Google Chrome". */
  source: string
  /** When it was added (milliseconds), or 0 when the browser does not say. */
  addedAt: number
}

/** One bookmark after the browsers are merged: one address, all the folders it is in, all the browsers that have it. */
export interface MergedMark {
  url: string
  title: string
  folders: string[][]
  sources: string[]
  addedAt: number
}

export interface MarkFolder {
  name: string
  folders: MarkFolder[]
  marks: MergedMark[]
}

const TOP_NAMES: Record<string, string> = {
  bookmark_bar: 'Bookmarks bar',
  other: 'Other bookmarks',
  synced: 'Mobile bookmarks',
  toolbar: 'Bookmarks bar',
  menu: 'Bookmarks menu',
  unfiled: 'Other bookmarks',
  mobile: 'Mobile bookmarks'
}

interface ChromiumNode {
  type?: string
  name?: string
  url?: string
  date_added?: string
  children?: ChromiumNode[]
}

/** A Chromium "Bookmarks" file: the bar, the other bookmarks and the mobile ones, each with folders inside. */
export function parseChromiumBookmarks(json: string, source: string): BrowserMark[] {
  let root: { roots?: Record<string, ChromiumNode> }
  try { root = JSON.parse(json) } catch { return [] }
  const out: BrowserMark[] = []
  const walk = (node: ChromiumNode, path: string[]): void => {
    if (node.type === 'url' && typeof node.url === 'string') {
      const micro = Number(node.date_added)
      out.push({
        url: node.url,
        title: typeof node.name === 'string' ? node.name : '',
        folder: path,
        source,
        addedAt: Number.isFinite(micro) && micro > 0 ? Math.round(micro / 1000) - CHROMIUM_EPOCH_MS : 0
      })
    } else if (Array.isArray(node.children)) {
      const name = typeof node.name === 'string' && node.name.trim() ? node.name.trim() : 'Folder'
      for (const child of node.children) walk(child, [...path, name])
    }
  }
  for (const [key, top] of Object.entries(root.roots ?? {})) {
    if (!top || typeof top !== 'object' || !Array.isArray(top.children)) continue
    for (const child of top.children) walk(child, [TOP_NAMES[key] ?? (top.name || key)])
  }
  return out
}

/** A row of Firefox's moz_bookmarks, joined with moz_places for the address. */
export interface FirefoxRow {
  id: number
  type: number // 1 = a bookmark, 2 = a folder
  parent: number
  title: string | null
  url: string | null
  /** Microseconds since 1970. */
  dateAdded: number | null
  /** Firefox's own name for the top folders: "toolbar", "menu", "unfiled", "mobile". */
  guid: string | null
}

/** Firefox's tags root. A tag is a folder under it, and each tagged page has a second bookmark row in that folder. */
const FIREFOX_TAGS_GUID = 'tags________'

export function parseFirefoxBookmarks(rows: FirefoxRow[], source: string): BrowserMark[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  /** Rows under the tags root are tags, not bookmarks: without this, every tagged page showed again in a "tags" folder. */
  const isTag = (row: FirefoxRow): boolean => {
    const seen = new Set<number>()
    for (let at = byId.get(row.parent); at && !seen.has(at.id); at = byId.get(at.parent)) {
      if (at.guid === FIREFOX_TAGS_GUID) return true
      seen.add(at.id)
    }
    return false
  }
  const pathOf = (row: FirefoxRow): string[] => {
    const path: string[] = []
    const seen = new Set<number>()
    let at = byId.get(row.parent)
    while (at && !seen.has(at.id)) {
      seen.add(at.id)
      const guid = at.guid ?? ''
      const top = guid.endsWith('_____') ? TOP_NAMES[guid.replace(/_+$/, '')] : undefined
      if (top) { path.unshift(top); break }
      if (!byId.has(at.parent)) break // the root itself has no name
      path.unshift((at.title ?? '').trim() || 'Folder')
      at = byId.get(at.parent)
    }
    return path
  }
  return rows
    .filter((r) => r.type === 1 && typeof r.url === 'string' && r.url !== '' && !isTag(r))
    .map((r) => ({ url: r.url as string, title: r.title ?? '', folder: pathOf(r), source, addedAt: r.dateAdded ? Math.round(r.dateAdded / 1000) : 0 }))
}

/** One address, one bookmark, whichever browsers hold it. Newest list first. Only web pages are kept. */
export function mergeMarks(list: BrowserMark[]): MergedMark[] {
  const map = new Map<string, MergedMark>()
  for (const m of list) {
    const url = normalizeBookmarkUrl(m.url)
    if (!url) continue
    const have = map.get(url)
    const title = m.title.trim().slice(0, 300)
    if (!have) {
      map.set(url, { url, title, folders: [m.folder], sources: [m.source], addedAt: m.addedAt })
      continue
    }
    if (!have.title && title) have.title = title
    if (!have.folders.some((f) => f.join('\u0000') === m.folder.join('\u0000'))) have.folders.push(m.folder)
    if (!have.sources.includes(m.source)) have.sources.push(m.source)
    if (m.addedAt > 0 && (have.addedAt === 0 || m.addedAt < have.addedAt)) have.addedAt = m.addedAt
  }
  return [...map.values()].sort((a, b) => b.addedAt - a.addedAt || a.url.localeCompare(b.url))
}

/** The merged folder tree: folders with the same path in two browsers are one folder. A bookmark shows in each folder it is in. */
export function buildFolderTree(marks: MergedMark[]): MarkFolder {
  const root: MarkFolder = { name: '', folders: [], marks: [] }
  for (const mark of marks) {
    for (const path of mark.folders) {
      let at = root
      for (const name of path) {
        let next = at.folders.find((f) => f.name === name)
        if (!next) { next = { name, folders: [], marks: [] }; at.folders.push(next) }
        at = next
      }
      at.marks.push(mark)
    }
  }
  const order = (f: MarkFolder): void => {
    const rank = (n: string) => { const i = ['Bookmarks bar', 'Bookmarks menu', 'Other bookmarks', 'Mobile bookmarks'].indexOf(n); return i < 0 ? 9 : i }
    f.folders.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    f.folders.forEach(order)
  }
  order(root)
  return root
}

/** Bookmarks that match what was typed (every word in the title or the address). */
export function matchMergedMarks(list: MergedMark[], text: string, limit = 6): MergedMark[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return list.slice(0, limit)
  return list.filter((b) => { const pool = `${b.title} ${b.url}`.toLowerCase(); return words.every((w) => pool.includes(w)) }).slice(0, limit)
}

/** A folder path as text: ['Bookmarks bar', 'Work'] becomes "Bookmarks bar/Work". */
export const folderPathText = (folder: string[]): string => folder.join('/')

/**
 * Every folder that holds bookmarks, with how many bookmarks are in it or in a folder below it.
 * A bookmark that sits in two folders is counted in each, and once in a parent they share.
 */
export function folderCounts(marks: MergedMark[]): Array<{ path: string; count: number }> {
  const urls = new Map<string, Set<string>>()
  for (const m of marks) {
    for (const folder of m.folders) {
      for (let i = 1; i <= folder.length; i++) {
        const path = folderPathText(folder.slice(0, i))
        const set = urls.get(path) ?? new Set<string>()
        set.add(m.url)
        urls.set(path, set)
      }
    }
  }
  return [...urls.entries()].map(([path, set]) => ({ path, count: set.size })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
