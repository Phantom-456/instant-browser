/**
 * Agent folders: bookmark folders that agents (through MCP) make for themselves. They are kept apart from the person's
 * own bookmarks, which agents can never change.
 */
import { bookmarkId, hostOf, normalizeBookmarkUrl } from './bookmarks'

export interface AgentBookmark {
  id: string
  url: string
  title: string
  createdAt: number
}

export interface AgentFolder {
  id: string
  name: string
  /** The id of the agent that owns it ('ag-...'). Old folders may hold the agent's name until it is matched. */
  owner: string
  /** The agent's name, for display. */
  ownerName: string
  /** The owner may remove pages from this folder and delete it. */
  allowDelete: boolean
  createdAt: number
  items: AgentBookmark[]
}

export const MAX_AGENT_FOLDERS = 100
export const MAX_FOLDER_ITEMS = 1000
export const MAX_FOLDER_NAME = 80
export const MAX_TITLE = 300

/** Who is asking: the agent behind a key. */
export interface AgentRef { id: string; name: string }

/** An id made by agentKeys. Anything else in `owner` is an old name. */
export const isAgentId = (owner: string): boolean => /^ag-[0-9a-f]{12}$/.test(owner)

/** The same agent, whatever the case or the spaces around its name. */
export const ownerKey = (owner: string): string => owner.trim().toLowerCase()

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

function parseItem(raw: unknown): AgentBookmark | null {
  const r = raw as Partial<AgentBookmark> | null
  if (!r || typeof r !== 'object' || typeof r.url !== 'string') return null
  const url = normalizeBookmarkUrl(r.url)
  if (!url) return null
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, MAX_TITLE) : hostOf(url)
  return { id: bookmarkId(url), url, title, createdAt: finite(r.createdAt) }
}

function parseFolder(raw: unknown): AgentFolder | null {
  const r = raw as Partial<AgentFolder> | null
  if (!r || typeof r !== 'object') return null
  if (typeof r.id !== 'string' || !r.id || typeof r.owner !== 'string' || !r.owner.trim()) return null
  if (typeof r.name !== 'string') return null
  const name = r.name.trim()
  if (name.length < 1 || name.length > MAX_FOLDER_NAME) return null
  const items: AgentBookmark[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(r.items) ? r.items : []) {
    const b = parseItem(item)
    if (!b || seen.has(b.id) || items.length >= MAX_FOLDER_ITEMS) continue
    seen.add(b.id)
    items.push(b)
  }
  const owner = r.owner.trim().slice(0, 60)
  const ownerName = typeof r.ownerName === 'string' && r.ownerName.trim() ? r.ownerName.trim().slice(0, 60) : owner
  return { id: r.id, name, owner, ownerName, allowDelete: r.allowDelete === true, createdAt: finite(r.createdAt), items }
}

/** Read what is saved on disk. Anything that does not fit is dropped. */
export function parseAgentFolders(raw: unknown): AgentFolder[] {
  if (!Array.isArray(raw)) return []
  const folders: AgentFolder[] = []
  const ids = new Set<string>()
  for (const entry of raw) {
    const f = parseFolder(entry)
    if (!f || ids.has(f.id) || folders.length >= MAX_AGENT_FOLDERS) continue
    ids.add(f.id)
    folders.push(f)
  }
  return folders
}
