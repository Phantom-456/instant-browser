import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { bookmarkId, hostOf, normalizeBookmarkUrl } from '../shared/bookmarkUrl'
import { MAX_AGENT_FOLDERS, MAX_FOLDER_ITEMS, MAX_FOLDER_NAME, MAX_TITLE, isAgentId, parseAgentFolders, type AgentBookmark, type AgentFolder, type AgentRef } from '../shared/agentBookmarks'

const NO_DELETE = 'This folder does not allow deletion. allowDelete is chosen when a folder is made, and only the person can change it later (Settings > Agents).'

/** What happened to one page of an add. */
export type AddResult = { status: 'added' | 'exists'; item: AgentBookmark; error?: undefined } | { status: 'error'; error: string; item?: undefined }

/**
 * The bookmark folders that agents made (`agent-bookmarks.json`, readable only by you). Separate from the person's own
 * bookmarks. Only a folder's owner can add to it, and the owner can remove things only when the folder allows it.
 */
export class AgentBookmarkStore {
  private list: AgentFolder[] = []
  /** Something changed. */
  onChange: (() => void) | null = null

  constructor(private readonly path: string, private readonly now: () => number = Date.now) {
    try {
      this.list = parseAgentFolders((JSON.parse(readFileSync(path, 'utf8')) as { folders?: unknown }).folders)
    } catch { /* no file yet, or a broken one: start empty (a broken file is not trusted) */ }
  }

  folders(): AgentFolder[] { return this.list }

  folder(folderId: string): AgentFolder {
    const f = this.list.find((x) => x.id === folderId)
    if (!f) throw new Error(`No agent folder with id "${folderId}". Use list_agent_folders to see the folders.`)
    return f
  }

  /** Is this folder the agent's? Only its key's id counts: a name never does, since any agent can be given any name. */
  mine(f: AgentFolder, caller: AgentRef): boolean {
    return f.owner === caller.id
  }

  /**
   * Folders from the one-key version hold a name, not an agent id. They were all made with that one key, so they go to
   * the agent that still holds it (`legacy`), once, at start. With no such agent (its key was renewed, or it was
   * removed) they stay unowned: any agent can read them, only the person can change or remove them.
   */
  adoptLegacy(legacy: AgentRef | null): number {
    if (!legacy) return 0
    let moved = 0
    for (const f of this.list) {
      if (isAgentId(f.owner)) continue
      f.owner = legacy.id
      f.ownerName = legacy.name
      moved++
    }
    if (moved) this.save()
    return moved
  }

  createFolder(caller: AgentRef, name: string, allowDelete: boolean): AgentFolder {
    const clean = typeof name === 'string' ? name.trim() : ''
    if (clean.length < 1 || clean.length > MAX_FOLDER_NAME) throw new Error(`The folder name must be 1 to ${MAX_FOLDER_NAME} characters.`)
    if (this.list.length >= MAX_AGENT_FOLDERS) throw new Error(`There are already ${MAX_AGENT_FOLDERS} agent folders. Delete one you own, or ask the person to remove some in Settings > Agents.`)
    if (this.list.some((f) => this.mine(f, caller) && f.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error(`You already have a folder named "${clean}". Use list_agent_folders to find it, or pick another name.`)
    }
    const folder: AgentFolder = { id: `af-${randomUUID().replace(/-/g, '').slice(0, 12)}`, name: clean, owner: caller.id, ownerName: caller.name, allowDelete, createdAt: this.now(), items: [] }
    this.list.push(folder)
    this.save()
    return folder
  }

  private owned(caller: AgentRef, folderId: string, action: string): AgentFolder {
    const f = this.folder(folderId)
    if (!this.mine(f, caller)) throw new Error(`Only the owner of this folder ("${f.ownerName}") can ${action}. You can make your own folder with create_bookmark_folder.`)
    return f
  }

  /** The person (from Settings) changes whether the owning agent may delete in a folder. Agents cannot: they choose it once, at creation. */
  userSetPermission(folderId: string, allowDelete: boolean): AgentFolder {
    const f = this.folder(folderId)
    f.allowDelete = allowDelete
    this.save()
    return f
  }

  add(caller: AgentRef, folderId: string, url: string, title: string): AgentBookmark {
    const r = this.addMany(caller, folderId, [{ url, title }])[0]!
    if (r.status === 'error') throw new Error(r.error)
    return r.item!
  }

  /**
   * Add several pages in one go, with one file write. Each page gets its own result, so one bad address or a full
   * folder does not stop the rest. Only the owner may add; that check covers the whole call.
   */
  addMany(caller: AgentRef, folderId: string, entries: Array<{ url: string; title: string }>): AddResult[] {
    const f = this.owned(caller, folderId, 'add pages to it')
    const out: AddResult[] = []
    let changed = false
    for (const e of entries) {
      const clean = normalizeBookmarkUrl(typeof e.url === 'string' ? e.url : '')
      if (!clean) { out.push({ status: 'error', error: 'The address must be a web page that starts with http:// or https://.' }); continue }
      const id = bookmarkId(clean)
      const existing = f.items.find((b) => b.id === id)
      if (existing) { out.push({ status: 'exists', item: existing }); continue }
      if (f.items.length >= MAX_FOLDER_ITEMS) { out.push({ status: 'error', error: `This folder is full (${MAX_FOLDER_ITEMS} pages). Remove some or make another folder.` }); continue }
      const item: AgentBookmark = { id, url: clean, title: (typeof e.title === 'string' ? e.title.trim().slice(0, MAX_TITLE) : '') || hostOf(clean), createdAt: this.now() }
      f.items.push(item)
      changed = true
      out.push({ status: 'added', item })
    }
    if (changed) this.save()
    return out
  }

  remove(caller: AgentRef, folderId: string, bookmarkIdValue: string): void {
    const f = this.owned(caller, folderId, 'remove pages from it')
    if (!f.allowDelete) throw new Error(NO_DELETE)
    const at = f.items.findIndex((b) => b.id === bookmarkIdValue)
    if (at < 0) throw new Error(`No bookmark with id "${bookmarkIdValue}" in this folder. Use list_agent_folder to see its pages.`)
    f.items.splice(at, 1)
    this.save()
  }

  deleteFolder(caller: AgentRef, folderId: string): void {
    const f = this.owned(caller, folderId, 'delete it')
    if (!f.allowDelete) throw new Error(NO_DELETE)
    this.list = this.list.filter((x) => x !== f)
    this.save()
  }

  /** The person (from Settings) can always remove any agent folder. */
  userRemoveFolder(folderId: string): boolean {
    const before = this.list.length
    this.list = this.list.filter((f) => f.id !== folderId)
    if (this.list.length === before) return false
    this.save()
    return true
  }

  /** The person (from Manage) can always remove one page from any agent folder. */
  userRemoveItem(folderId: string, itemId: string): boolean {
    const f = this.list.find((x) => x.id === folderId)
    const at = f ? f.items.findIndex((b) => b.id === itemId) : -1
    if (!f || at < 0) return false
    f.items.splice(at, 1)
    this.save()
    return true
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, folders: this.list }), { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, this.path)
    this.onChange?.()
  }
}
