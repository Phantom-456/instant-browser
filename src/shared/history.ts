/** One row read from a browser's history file. */
export interface RawVisit {
  url: string
  title: string
  visits: number
  /** Milliseconds since 1970. */
  lastVisit: number
  /** The browser it came from, for example "Dia". */
  source: string
}

export interface SearchEntry { term: string; visits: number; lastVisit: number; sources: string[] }
export interface PageEntry { url: string; title: string; visits: number; lastVisit: number; sources: string[] }
export interface History { searches: SearchEntry[]; pages: PageEntry[] }

const DAY = 24 * 3600 * 1000

/** Milliseconds between 1601-01-01 (Chromium's time zero) and 1970-01-01. */
export const CHROMIUM_EPOCH_MS = 11_644_473_600_000

/** Chromium stores time as microseconds since 1601-01-01. */
export function chromiumTimeToMs(microseconds: number): number {
  return microseconds / 1000 - CHROMIUM_EPOCH_MS
}

interface Engine { host: RegExp; path: string; param: string }
const ENGINES: Engine[] = [
  { host: /(^|\.)google\.[a-z.]+$/, path: '/search', param: 'q' },
  { host: /^(www\.)?duckduckgo\.com$/, path: '/', param: 'q' },
  { host: /(^|\.)bing\.com$/, path: '/search', param: 'q' },
  { host: /^search\.brave\.com$/, path: '/search', param: 'q' },
  { host: /^search\.yahoo\.com$/, path: '/search', param: 'p' },
  { host: /(^|\.)ecosia\.org$/, path: '/search', param: 'q' }
]

/** The words typed into a search engine, read from the address of its results page. null for any other page. */
export function searchTermFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const engine = ENGINES.find((e) => e.host.test(u.hostname) && u.pathname === e.path)
    const raw = engine ? u.searchParams.get(engine.param) : null
    const term = raw?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
    return term.length >= 2 && term.length <= 120 ? term : null
  } catch {
    return null
  }
}

function pageKey(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

/** Combine rows from all browsers: searches grouped by their words, pages grouped by address. */
export function buildHistory(rows: RawVisit[]): History {
  const searches = new Map<string, SearchEntry>()
  const pages = new Map<string, PageEntry & { titleTime: number }>()
  for (const row of rows) {
    const term = searchTermFromUrl(row.url)
    if (term) {
      const s = searches.get(term) ?? { term, visits: 0, lastVisit: 0, sources: [] }
      s.visits += row.visits
      s.lastVisit = Math.max(s.lastVisit, row.lastVisit)
      if (!s.sources.includes(row.source)) s.sources.push(row.source)
      searches.set(term, s)
      continue // a results page is a search, not a page to revisit
    }
    const key = pageKey(row.url)
    if (!key) continue
    const p = pages.get(key) ?? { url: key, title: '', visits: 0, lastVisit: 0, sources: [], titleTime: 0 }
    p.visits += row.visits
    p.lastVisit = Math.max(p.lastVisit, row.lastVisit)
    if (row.title.trim() && row.lastVisit >= p.titleTime) { p.title = row.title.trim(); p.titleTime = row.lastVisit }
    if (!p.sources.includes(row.source)) p.sources.push(row.source)
    pages.set(key, p)
  }
  return {
    searches: [...searches.values()],
    pages: [...pages.values()].map(({ titleTime: _t, ...page }) => ({ ...page, title: page.title || hostOf(page.url) }))
  }
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return url }
}

/** Frequent and recent visits score higher. */
function frecency(visits: number, lastVisit: number, now: number): number {
  const ageDays = Math.max(0, (now - lastVisit) / DAY)
  return Math.log2(1 + visits) * 2 + 6 / (1 + ageDays / 3)
}

/** Every word of the query must be in the text (any order, any case). */
export function matchesQuery(text: string, query: string): boolean {
  const hay = text.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word))
}

/** The searches used most recently (shown when nothing is typed). */
export function recentSearches(h: History, limit: number, _now: number): SearchEntry[] {
  return [...h.searches].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, limit)
}

export function recentPages(h: History, limit: number, _now: number): PageEntry[] {
  return [...h.pages].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, limit)
}

/** History that matches the typed text, best first. */
export function findHistory(
  h: History,
  query: string,
  now: number,
  limits: { searches: number; pages: number }
): { searches: SearchEntry[]; pages: PageEntry[] } {
  const q = query.trim().toLowerCase()
  if (!q) return { searches: [], pages: [] }
  const searches = h.searches
    .filter((s) => matchesQuery(s.term, q))
    .map((s) => ({ s, score: frecency(s.visits, s.lastVisit, now) + (s.term.startsWith(q) ? 5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limits.searches)
    .map((x) => x.s)
  const pages = h.pages
    .filter((p) => matchesQuery(`${p.title} ${p.url}`, q))
    .map((p) => {
      const startsLikeIt = hostOf(p.url).startsWith(q) || p.title.toLowerCase().startsWith(q)
      return { p, score: frecency(p.visits, p.lastVisit, now) + (startsLikeIt ? 3 : 0) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limits.pages)
    .map((x) => x.p)
  return { searches, pages }
}

/** Keep the history small, so it is quick to send between processes and to search. Newest first. */
export function capHistory(h: History, maxSearches: number, maxPages: number, _now: number): History {
  return {
    searches: [...h.searches].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, maxSearches),
    pages: [...h.pages].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, maxPages)
  }
}

/** Add the entries of `b` into `a` (same searches and pages are combined). Returns a new history. */
export function mergeHistory(a: History, b: History): History {
  const searches = new Map(a.searches.map((s) => [s.term, { ...s, sources: [...s.sources] }]))
  for (const s of b.searches) {
    const x = searches.get(s.term)
    if (!x) { searches.set(s.term, { ...s, sources: [...s.sources] }); continue }
    x.visits += s.visits
    x.lastVisit = Math.max(x.lastVisit, s.lastVisit)
    for (const src of s.sources) if (!x.sources.includes(src)) x.sources.push(src)
  }
  const pages = new Map(a.pages.map((p) => [p.url, { ...p, sources: [...p.sources] }]))
  for (const p of b.pages) {
    const x = pages.get(p.url)
    if (!x) { pages.set(p.url, { ...p, sources: [...p.sources] }); continue }
    x.visits += p.visits
    if (p.lastVisit >= x.lastVisit && p.title && p.title !== hostOf(p.url)) x.title = p.title
    x.lastVisit = Math.max(x.lastVisit, p.lastVisit)
    for (const src of p.sources) if (!x.sources.includes(src)) x.sources.push(src)
  }
  return { searches: [...searches.values()], pages: [...pages.values()] }
}
