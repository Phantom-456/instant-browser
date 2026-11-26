import { bool, str, type McpTool } from '../../shared/mcp/protocol'
import type { AgentBookmark, AgentFolder, AgentRef } from '../../shared/agentBookmarks'
import type { AgentBookmarkStore } from '../agentBookmarkStore'

const who = (ctx: { client: string; agentId: string }): AgentRef => ({ id: ctx.agentId, name: ctx.client })
const iso = (ms: number) => new Date(ms).toISOString()
const idSchema = (what: string) => ({ type: 'string', description: what })
const MAX_BATCH = 50
const RULES = 'Agent folders are separate from the person\'s own bookmarks, which an agent can never change. Only a folder\'s owner (the agent that made it) can add to it. Pages can be removed, and the folder deleted, only by its owner and only when the folder has allowDelete on.'

/** The tools for agent folders. They never touch the person's own bookmarks. */
export function agentBookmarkTools(store: AgentBookmarkStore): McpTool[] {
  const item = (b: AgentBookmark) => ({ id: b.id, title: b.title, url: b.url, createdAt: iso(b.createdAt) })
  const summary = (f: AgentFolder, caller: AgentRef) => ({
    id: f.id, name: f.name, owner: f.ownerName, allowDelete: f.allowDelete, mine: store.mine(f, caller), createdAt: iso(f.createdAt), count: f.items.length
  })
  return [
    {
      name: 'list_agent_folders',
      group: 'folders',
      changes: false,
      description: `List the bookmark folders that agents made, from every agent, with owner and whether deletion is allowed ("mine" is true for your own). Read-only. ${RULES}`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: (_args, ctx) => ({ folders: store.folders().map((f) => summary(f, who(ctx))) })
    },
    {
      name: 'list_agent_folder',
      group: 'folders',
      changes: false,
      description: 'List the pages in one agent folder. Read-only. Any agent may read any agent folder.',
      inputSchema: { type: 'object', properties: { folderId: idSchema('The folder id from list_agent_folders.') }, required: ['folderId'], additionalProperties: false },
      run(args, ctx) {
        const f = store.folder(str(args, 'folderId', 100, true))
        return { ...summary(f, who(ctx)), items: f.items.map(item) }
      }
    },
    {
      name: 'create_bookmark_folder',
      group: 'folders',
      changes: true,
      description: `Make a new bookmark folder that you own, for saving pages with add_bookmark. It is an agent folder, not one of the person's folders. The name must be unique among your folders. Set allowDelete true only if you want to be able to remove pages or delete the folder later (default false: pages can be added but not removed). You choose this once; only the person can change it later. ${RULES}`,
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', minLength: 1, maxLength: 80, description: 'Folder name, 1 to 80 characters.' }, allowDelete: { type: 'boolean', default: false, description: 'Let you remove pages and delete the folder.' } },
        required: ['name'],
        additionalProperties: false
      },
      run(args, ctx) {
        const f = store.createFolder(who(ctx), str(args, 'name', 200, true), bool(args, 'allowDelete', false))
        return summary(f, who(ctx))
      }
    },
    {
      name: 'add_bookmark',
      group: 'folders',
      changes: true,
      description: `Save web pages into an agent folder that you own. It is saved into the agent folder only, never into the person's own bookmarks. Give one page with "url" (and optional "title"), or up to ${MAX_BATCH} pages with "items" ([{ url, title? }]). With "items" you get one result per page ("added", "exists" or "error"); one bad page does not stop the rest. Adding the same address again returns the page already there. ${RULES}`,
      inputSchema: {
        type: 'object',
        properties: {
          folderId: idSchema('The folder id.'),
          url: { type: 'string', description: 'A web address (http or https). Use this or items.' },
          title: { type: 'string', description: 'Optional title, up to 300 characters.' },
          items: {
            type: 'array', maxItems: MAX_BATCH,
            description: `Up to ${MAX_BATCH} pages to save at once. Use this or url.`,
            items: { type: 'object', properties: { url: { type: 'string', description: 'A web address (http or https).' }, title: { type: 'string', description: 'Optional title.' } }, required: ['url'], additionalProperties: false }
          }
        },
        required: ['folderId'],
        additionalProperties: false
      },
      run(args, ctx) {
        const folderId = str(args, 'folderId', 100, true)
        if (args.items === undefined) {
          if (args.url === undefined) throw new Error('Give "url" for one page, or "items" for several.')
          return item(store.add(who(ctx), folderId, str(args, 'url', 4096, true), str(args, 'title', 1000)))
        }
        if (args.url !== undefined || args.title !== undefined) throw new Error('Give either "items" or "url", not both.')
        if (!Array.isArray(args.items) || args.items.length < 1) throw new Error('"items" must be a list with at least one page.')
        if (args.items.length > MAX_BATCH) throw new Error(`"items" can hold at most ${MAX_BATCH} pages. Send the rest in another call.`)
        const entries = args.items.map((raw, i) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`items[${i}] must be an object with a "url".`)
          const o = raw as Record<string, unknown>
          return { url: str(o, 'url', 4096), title: str(o, 'title', 1000) }
        })
        const results = store.addMany(who(ctx), folderId, entries).map((r, i) =>
          r.status === 'error' ? { url: entries[i]!.url, status: r.status, error: r.error } : { status: r.status, ...item(r.item) })
        return {
          results,
          added: results.filter((r) => r.status === 'added').length,
          exists: results.filter((r) => r.status === 'exists').length,
          errors: results.filter((r) => r.status === 'error').length
        }
      }
    },
    {
      name: 'remove_bookmark',
      group: 'folders',
      changes: true,
      description: 'Remove one page from an agent folder. Works only on a folder you own that has allowDelete on; otherwise it is refused. It never touches the person\'s own bookmarks.',
      inputSchema: { type: 'object', properties: { folderId: idSchema('The folder id.'), bookmarkId: idSchema('The page id from list_agent_folder.') }, required: ['folderId', 'bookmarkId'], additionalProperties: false },
      run(args, ctx) {
        store.remove(who(ctx), str(args, 'folderId', 100, true), str(args, 'bookmarkId', 100, true))
        return { removed: true }
      }
    },
    {
      name: 'delete_bookmark_folder',
      group: 'folders',
      changes: true,
      description: 'Delete an agent folder and every page in it. Works only on a folder you own that has allowDelete on; otherwise it is refused. It never touches the person\'s own bookmarks.',
      inputSchema: { type: 'object', properties: { folderId: idSchema('The folder id.') }, required: ['folderId'], additionalProperties: false },
      run(args, ctx) {
        store.deleteFolder(who(ctx), str(args, 'folderId', 100, true))
        return { deleted: true }
      }
    }
  ]
}
