import { bool, str, type McpTool } from '../../shared/mcp/protocol'
import type { PinRecord } from '../../shared/pins/model'
import { WindowOwners } from './windowOwners'

export interface WindowToolDeps {
  /** Opens a window and returns its id, or null when it could not. */
  open(url: string, opts?: { focus: boolean }): number | null
  /** Closes a window. False when there is no such window. */
  close(id: number): boolean
  windows(): Array<{ id: number; title: string; url: string }>
  show(id: number): boolean
  /** Loads an address in an open window. False when there is no such window. */
  navigate(id: number, url: string): boolean
  /** Back or forward. null: no such window. false: no history that way. */
  step(id: number, dir: 'back' | 'forward'): boolean | null
  reload(id: number): boolean
  pins(): PinRecord[]
  pinAct(id: string, action: 'restore' | 'offload'): Promise<void>
  now?: () => number
  /** Shared with list_windows so it can say which windows the caller opened. */
  owners?: WindowOwners
}

const MAX_OPENS = 5
const MAX_URLS = 5

/** The same page address, ignoring a trailing slash on the path and the part after #. */
function sameAddress(a: string, b: string): boolean {
  const norm = (x: string) => { try { const u = new URL(x); u.hash = ''; return u.href.replace(/\/$/, '') } catch { return x } }
  return norm(a) === norm(b)
}
const WINDOW_MS = 60_000

/** The tools that open windows and use pins. An agent can close only windows it opened, and never deletes a pin. */
export function windowTools(deps: WindowToolDeps): McpTool[] {
  const now = deps.now ?? Date.now
  const opens = new Map<string, number[]>() // times of recent opens, per agent
  const owners = deps.owners ?? new WindowOwners() // window ids each agent opened
  // One shared budget per agent for opening and navigating
  const spend = (agentId: string, message: string): void => {
    const t = now()
    const recent = (opens.get(agentId) ?? []).filter((at) => t - at < WINDOW_MS)
    if (recent.length >= MAX_OPENS) throw new Error(message)
    recent.push(t)
    opens.set(agentId, recent)
  }
  const windowId = (args: Record<string, unknown>): number => {
    const id = args.id
    if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error('"id" must be a whole number')
    return id
  }
  const gone = (): Error => new Error('No open window has that id. Use list_windows to see the open windows.')
  const urlOf = (id: number): string => deps.windows().find((w) => w.id === id)?.url ?? ''
  const idSchema = { type: 'object', properties: { id: { type: 'integer', description: 'The window id from list_windows.' } }, required: ['id'], additionalProperties: false } as const
  return [
    {
      name: 'open_window',
      group: 'windows',
      changes: true,
      description: `Open web pages in new small windows that the person sees and can use. Use it to show them a page. Give one page with "url", or up to ${MAX_URLS} with "urls". Only http and https addresses work. Every window that opens costs one of your ${MAX_OPENS} opens per minute (shared with navigate_window), so a batch cannot get around the limit; with "urls" each address gets its own result and the ones over the limit are refused. "focus" (default true): false opens the window behind, without taking focus. "reuseIfOpen" (default false): if a window already shows the same address, its id comes back with reused true and nothing is spent. You can close only windows you opened (close_window); a reused window you did not open stays closed to you ("canClose" says).`,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'A web address (http or https). Use this or urls.' },
          urls: { type: 'array', maxItems: MAX_URLS, items: { type: 'string' }, description: `Up to ${MAX_URLS} web addresses (http or https). Use this or url.` },
          focus: { type: 'boolean', default: true, description: 'false opens the window behind and does not take focus.' },
          reuseIfOpen: { type: 'boolean', default: false, description: 'Use an open window that already shows the same address instead of opening another.' }
        },
        additionalProperties: false
      },
      run(args, ctx) {
        const focus = bool(args, 'focus', true)
        const reuse = bool(args, 'reuseIfOpen', false)
        const batch = args.urls !== undefined
        if (batch && args.url !== undefined) throw new Error('Give either "url" or "urls", not both.')
        if (!batch && args.url === undefined) throw new Error('Give "url" for one page, or "urls" for several.')
        let raws: string[]
        if (batch) {
          if (!Array.isArray(args.urls) || args.urls.length < 1) throw new Error('"urls" must be a list with at least one address.')
          if (args.urls.length > MAX_URLS) throw new Error(`"urls" can hold at most ${MAX_URLS} addresses. Open the rest in a later call.`)
          raws = args.urls.map((u, i) => { if (typeof u !== 'string' || u.length > 4096) throw new Error(`urls[${i}] must be text.`); return u.trim() })
        } else raws = [str(args, 'url', 4096, true).trim()]
        const seen = new Map<string, number>() // opened or reused in this call, by address
        const one = (raw: string) => {
          let url: URL
          try { url = new URL(raw) } catch { throw new Error('That is not a valid web address.') }
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http:// and https:// addresses can be opened.')
          if (reuse) {
            const known = seen.get(url.href) ?? deps.windows().find((w) => sameAddress(w.url, url.href))?.id
            if (known !== undefined) {
              seen.set(url.href, known)
              return { opened: false, reused: true, id: known, url: url.href, canClose: owners.owns(ctx.agentId, known) }
            }
          }
          spend(ctx.agentId, 'Too many windows opened in the last minute. Wait and try again.')
          const id = deps.open(url.href, { focus })
          if (id !== null) { owners.add(ctx.agentId, id); seen.set(url.href, id) }
          return { opened: true, id, url: url.href, canClose: id !== null }
        }
        if (!batch) {
          const r = one(raws[0]!)
          return r.reused ? r : { opened: true, id: r.id, url: r.url }
        }
        const results = raws.map((raw) => {
          try {
            const r = one(raw)
            return { status: r.reused ? 'reused' : 'opened', ...r }
          } catch (e) { return { status: 'error', url: raw, error: (e as Error).message } }
        })
        return { results, opened: results.filter((r) => r.status === 'opened').length, reused: results.filter((r) => r.status === 'reused').length, errors: results.filter((r) => r.status === 'error').length }
      }
    },
    {
      name: 'close_window',
      group: 'windows',
      changes: true,
      description: 'Close a window that you opened with open_window. You cannot close the person\'s own windows or windows other agents opened.',
      inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'The window id that open_window gave you.' } }, required: ['id'], additionalProperties: false },
      run(args, ctx) {
        const id = args.id
        if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error('"id" must be a whole number')
        if (!owners.owns(ctx.agentId, id)) throw new Error('You can only close windows you opened.')
        owners.remove(id)
        if (!deps.close(id)) throw new Error('That window is already closed.')
        return { closed: true }
      }
    },
    {
      name: 'focus_window',
      group: 'windows',
      changes: true,
      description: 'Bring one open window to the front. Get the id from list_windows.',
      inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'The window id from list_windows.' } }, required: ['id'], additionalProperties: false },
      run(args) {
        const id = args.id
        if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error('"id" must be a whole number')
        if (!deps.show(id)) throw new Error('No open window has that id. Use list_windows to see the open windows.')
        return { focused: true }
      }
    },
    {
      name: 'navigate_window',
      group: 'windows',
      changes: true,
      description: 'Load a web page in a window that is already open. The person sees it happen. Only http and https addresses work. Navigating counts toward the same limit of 5 per minute as open_window.',
      inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'The window id from list_windows.' }, url: { type: 'string', description: 'A web address (http or https).' } }, required: ['id', 'url'], additionalProperties: false },
      run(args, ctx) {
        const id = windowId(args)
        const raw = str(args, 'url', 4096, true).trim()
        let url: URL
        try { url = new URL(raw) } catch { throw new Error('That is not a valid web address.') }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http:// and https:// addresses can be opened.')
        if (!deps.windows().some((w) => w.id === id)) throw gone()
        spend(ctx.agentId, 'Too many windows opened or navigated in the last minute. Wait and try again.')
        if (!deps.navigate(id, url.href)) throw gone()
        return { id, url: url.href }
      }
    },
    {
      name: 'go_back',
      group: 'windows',
      changes: true,
      description: 'Go back one page in an open window, like the back button.',
      inputSchema: idSchema,
      run(args) {
        const id = windowId(args)
        const r = deps.step(id, 'back')
        if (r === null) throw gone()
        return r ? { id, url: urlOf(id) } : { done: false, reason: 'Nothing to go back to.' }
      }
    },
    {
      name: 'go_forward',
      group: 'windows',
      changes: true,
      description: 'Go forward one page in an open window, like the forward button.',
      inputSchema: idSchema,
      run(args) {
        const id = windowId(args)
        const r = deps.step(id, 'forward')
        if (r === null) throw gone()
        return r ? { id, url: urlOf(id) } : { done: false, reason: 'Nothing to go forward to.' }
      }
    },
    {
      name: 'reload_window',
      group: 'windows',
      changes: true,
      description: 'Reload the page in an open window.',
      inputSchema: idSchema,
      run(args) {
        const id = windowId(args)
        if (!deps.reload(id)) throw gone()
        return { id, url: urlOf(id) }
      }
    },
    {
      name: 'pin_action',
      group: 'pins',
      changes: true,
      description: 'Open (bring back) or offload a pin. Get the id from list_pins. Agents can never delete pins.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The pin id from list_pins.' }, action: { type: 'string', enum: ['open', 'offload'] } },
        required: ['id', 'action'],
        additionalProperties: false
      },
      async run(args) {
        const id = str(args, 'id', 100, true)
        const action = args.action
        if (action !== 'open' && action !== 'offload') throw new Error('"action" must be "open" or "offload"')
        if (!deps.pins().some((p) => p.id === id)) throw new Error('No pin has that id. Use list_pins to see the pins.')
        await deps.pinAct(id, action === 'open' ? 'restore' : 'offload')
        return { done: true, id, action }
      }
    }
  ]
}
