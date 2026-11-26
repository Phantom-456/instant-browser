import { bool, int, str, type McpTool } from '../../shared/mcp/protocol'
import { folderCounts, folderPathText, type MergedMark } from '../../shared/browserBookmarks'
import type { PageFilter } from '../../shared/history'
import type { PinRecord } from '../../shared/pins/model'
import type { WindowOwners } from './windowOwners'

export interface BrowserToolDeps {
  bookmarks: () => Array<{ id: string; title: string; url: string; createdAt: number }>
  browserMarks: () => Array<{ title: string; url: string; folders?: string[][]; sources?: string[]; addedAt?: number }>
  history: (filter: PageFilter) => { total: number; pages: Array<{ url: string; title: string; visits: number; lastVisit: number; sources: string[]; lastBySource?: Record<string, number> }>; nextOffset: number | null }
  pins: () => PinRecord[]
  archivedPins: () => PinRecord[]
  windows: () => Array<{ id: number; title: string; url: string; focused?: boolean; bounds?: { x: number; y: number; width: number; height: number } }>
  /** Who opened which window. Without it, no window counts as opened by an agent. */
  owners?: WindowOwners
  tabs: () => { on: boolean; tabs: Array<{ browser: string; title: string; url: string }> }
  sitePermissions: () => Array<{ origin: string; permission: string; decision: string }>
  downloads: (limit: number) => Array<{ url: string; filename: string; savePath: string; state: string; receivedBytes: number; totalBytes: number; startedAt: number }>
}

const iso = (ms: number) => new Date(ms).toISOString()

/** An optional ISO time argument, in milliseconds. Refuses text that is not a date. */
function isoTime(args: Record<string, unknown>, key: string): number | undefined {
  const raw = str(args, key, 40)
  if (!raw) return undefined
  const ms = /^\d{4}-\d{2}-\d{2}/.test(raw) ? Date.parse(raw) : NaN
  if (!Number.isFinite(ms)) throw new Error(`"${key}" must be an ISO date and time such as 2026-11-24T00:00:00Z.`)
  return ms
}

/** A download address without its query and fragment: signed download links often carry a key or token there. */
export function withoutQuery(url: string): string {
  try { const u = new URL(url); u.search = ''; u.hash = ''; u.username = ''; u.password = ''; return u.toString() } catch { return '' }
}

/** Every word must be in the title or the address. */
function matches(query: string, ...fields: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = fields.join('\n').toLowerCase()
  return words.every((w) => text.includes(w))
}

const limitSchema = { type: 'integer', minimum: 1, maximum: 500, default: 100, description: 'The most results to return.' }
const querySchema = { type: 'string', description: 'Only results that have every word in the title or address.' }

/** The read-only tools. Nothing here changes data. */
export function browserTools(deps: BrowserToolDeps): McpTool[] {
  const pinOut = (p: PinRecord) => ({
    id: p.id, title: p.title, label: p.label, url: p.url, state: p.state, archived: p.archived,
    createdAt: iso(p.createdAt), lastUsedAt: iso(p.lastUsedAt)
  })
  return [
    {
      name: 'list_bookmarks',
      group: 'read',
      changes: false,
      description: 'List the bookmarks saved in Talaria, newest first. Read-only. Use "query" to search by words in the title or address.',
      inputSchema: { type: 'object', properties: { query: querySchema, limit: limitSchema }, additionalProperties: false },
      run(args) {
        const query = str(args, 'query', 200)
        const limit = int(args, 'limit', 100, 1, 500)
        const found = deps.bookmarks().filter((b) => matches(query, b.title, b.url))
        return { bookmarks: found.slice(0, limit).map((b) => ({ id: b.id, title: b.title, url: b.url, createdAt: iso(b.createdAt) })), total: found.length }
      }
    },
    {
      name: 'list_browser_bookmarks',
      group: 'read',
      changes: false,
      description: 'List bookmarks read from the person\'s other browsers (Chrome, Safari and so on), merged by address. Each has "folders" (paths such as "Bookmarks bar/Work"; it can sit in several) and "sources" (the browsers that have it). Read-only. Use "query" to search, "folder" to keep one folder and what is inside it (a prefix of the path, any case), "source" for one browser (see list_browser_bookmark_folders for the names), and "offset" with "nextOffset" to read on. "total" is how many match.',
      inputSchema: {
        type: 'object',
        properties: {
          query: querySchema,
          limit: limitSchema,
          folder: { type: 'string', description: 'A folder path or the start of one, for example "Bookmarks bar/Work". Any case.' },
          source: { type: 'string', description: 'A browser name (any case), for example "Google Chrome".' },
          offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0, description: 'How many matching bookmarks to skip (use nextOffset from the last call).' }
        },
        additionalProperties: false
      },
      run(args) {
        const query = str(args, 'query', 200)
        const limit = int(args, 'limit', 100, 1, 500)
        const offset = int(args, 'offset', 0, 0, 100000)
        const folder = str(args, 'folder', 500).trim().toLowerCase()
        const source = str(args, 'source', 60).trim().toLowerCase()
        const found = deps.browserMarks().filter((b) =>
          matches(query, b.title, b.url) &&
          (!source || (b.sources ?? []).some((s) => s.toLowerCase() === source)) &&
          (!folder || (b.folders ?? []).some((f) => folderPathText(f).toLowerCase().startsWith(folder))))
        const end = offset + limit
        return {
          total: found.length,
          nextOffset: end < found.length ? end : null,
          bookmarks: found.slice(offset, end).map((b) => ({
            title: b.title, url: b.url,
            folders: (b.folders ?? []).map(folderPathText),
            sources: b.sources ?? [],
            addedAt: b.addedAt ? iso(b.addedAt) : null
          }))
        }
      }
    },
    {
      name: 'list_browser_bookmark_folders',
      group: 'read',
      changes: false,
      description: 'List the folders in the person\'s other browsers\' bookmarks as paths (for example "Bookmarks bar/Work") with how many bookmarks each holds, including the ones in folders below it, and the browsers they come from. Read-only. Use a path as "folder" in list_browser_bookmarks.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run() {
        const marks = deps.browserMarks() as MergedMark[]
        return { folders: folderCounts(marks.map((m) => ({ ...m, folders: m.folders ?? [] }))), sources: [...new Set(marks.flatMap((m) => m.sources ?? []))].sort() }
      }
    },
    {
      name: 'list_history',
      group: 'read',
      changes: false,
      description: 'List pages from the browsing history (Talaria and the other browsers), most recent first. Read-only. Use "query" to search, "since" and "before" (ISO times such as 2026-11-24T00:00:00Z) to limit the time, and "source" (a browser name such as Dia) to see only that browser; the time limits then use that browser\'s last visit. "total" is how many pages match; when "nextOffset" is not null, call again with it as "offset" to read on. Only each page\'s last visit in each browser is kept, not every visit.',
      inputSchema: {
        type: 'object',
        properties: {
          query: querySchema,
          limit: limitSchema,
          since: { type: 'string', description: 'Only pages last visited at or after this ISO time.' },
          before: { type: 'string', description: 'Only pages last visited before this ISO time.' },
          source: { type: 'string', description: 'A browser name (any case), for example Dia or Chrome.' },
          offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0, description: 'How many matching pages to skip (use nextOffset from the last call).' }
        },
        additionalProperties: false
      },
      run(args) {
        const query = str(args, 'query', 200)
        const limit = int(args, 'limit', 100, 1, 500)
        const offset = int(args, 'offset', 0, 0, 100000)
        const source = str(args, 'source', 60)
        const since = isoTime(args, 'since')
        const before = isoTime(args, 'before')
        if (since !== undefined && before !== undefined && since >= before) throw new Error('"since" must be earlier than "before".')
        const found = deps.history({ query, since, before, source: source || undefined, offset, limit })
        return {
          total: found.total,
          nextOffset: found.nextOffset,
          pages: found.pages.map((p) => ({
            url: p.url, title: p.title, visits: p.visits, lastVisit: iso(p.lastVisit), sources: p.sources,
            lastVisitBySource: Object.fromEntries(Object.entries(p.lastBySource ?? Object.fromEntries(p.sources.map((s) => [s, p.lastVisit]))).map(([k, v]) => [k, iso(v)]))
          }))
        }
      }
    },
    {
      name: 'list_pins',
      group: 'read',
      changes: false,
      description: 'List the pins (small floating pages) in Talaria. Read-only. Archived pins are left out unless "includeArchived" is true.',
      inputSchema: { type: 'object', properties: { includeArchived: { type: 'boolean', default: false, description: 'Also list archived pins.' } }, additionalProperties: false },
      run(args) {
        const withArchived = bool(args, 'includeArchived', false)
        return { pins: [...deps.pins(), ...(withArchived ? deps.archivedPins() : [])].map(pinOut) }
      }
    },
    {
      name: 'list_windows',
      group: 'read',
      changes: false,
      description: 'List the small windows that are open in Talaria right now: id, title, address, whether it has focus, its position and size (bounds), and who opened it. "openedByYou" is true for windows you opened, and "canClose" says whether close_window will work (only for windows you opened). "openedByAgent" is true when some agent opened it; the person\'s own windows are false on both. Read-only.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run(_args, ctx) {
        const open = deps.windows()
        deps.owners?.prune(open.map((w) => w.id))
        return {
          windows: open.map((w) => {
            const openedByYou = deps.owners?.owns(ctx.agentId, w.id) ?? false
            return {
              id: w.id, title: w.title, url: w.url,
              focused: w.focused ?? false,
              bounds: w.bounds ?? null,
              openedByYou,
              openedByAgent: deps.owners?.hasOwner(w.id) ?? false,
              canClose: openedByYou
            }
          })
        }
      }
    },
    {
      name: 'list_browser_tabs',
      group: 'read',
      changes: false,
      description: 'List the tabs open right now in the person\'s other browsers (Chrome, Safari and so on). Read-only. Empty while listing tabs is off in Settings. Use "query" to search.',
      inputSchema: { type: 'object', properties: { query: querySchema, limit: limitSchema }, additionalProperties: false },
      run(args) {
        const query = str(args, 'query', 200)
        const limit = int(args, 'limit', 100, 1, 500)
        const { on, tabs } = deps.tabs()
        if (!on) return { tabs: [], note: 'Listing open tabs is off. The person can turn it on in Settings > Your browsers.' }
        const found = tabs.filter((t) => matches(query, t.title, t.url, t.browser))
        return { tabs: found.slice(0, limit).map((t) => ({ browser: t.browser, title: t.title, url: t.url })), total: found.length }
      }
    },
    {
      name: 'list_site_permissions',
      group: 'read',
      changes: false,
      description: 'List the permissions the person saved for sites (camera, microphone, location and so on), allowed or denied. Read-only.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => ({ permissions: deps.sitePermissions().map((p) => ({ origin: p.origin, permission: p.permission, decision: p.decision })) })
    },
    {
      name: 'list_downloads',
      group: 'read',
      changes: false,
      description: 'List the recent downloads in Talaria since it started, newest first. Read-only.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 50, description: 'The most downloads to return.' } }, additionalProperties: false },
      run(args) {
        const limit = int(args, 'limit', 50, 1, 200)
        return {
          downloads: deps.downloads(limit).slice(0, limit).map((d) => ({
            url: withoutQuery(d.url), filename: d.filename, savePath: d.savePath, state: d.state,
            receivedBytes: d.receivedBytes, totalBytes: d.totalBytes, startedAt: iso(d.startedAt)
          }))
        }
      }
    }
  ]
}
