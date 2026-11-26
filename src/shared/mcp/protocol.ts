/** A small MCP (Model Context Protocol) handler: JSON-RPC 2.0, tools only. Pure code, so it is easy to test. */

/** One change an agent made, for the activity list in Settings. */
export interface ActivityEntry {
  time: number
  agent: string
  tool: string
  args: string
  ok: boolean
  message: string
  /** How to put a changed setting back: the key and its old value. Only set by set_setting. */
  undo?: { key: string; value: unknown }
}

export interface McpTool {
  name: string
  /** What kind of tool this is. The person can switch off folders, windows, pins, pages, settings and acting in Settings. */
  group: 'read' | 'folders' | 'windows' | 'pins' | 'pages' | 'settings' | 'act'
  /** True when the tool changes something, so a call is written to the activity log. */
  changes: boolean
  description: string
  inputSchema: object
  /** The arguments as they are written to the activity log, when some must not be kept (typed text). */
  logArgs?(args: Record<string, unknown>): Record<string, unknown>
  /** Builds the undo for the activity log from what run() returned. */
  undo?(result: unknown): { key: string; value: unknown } | undefined
  run(args: Record<string, unknown>, ctx: { client: string; agentId: string }): Promise<unknown> | unknown
}

/** A tool result with a picture. The call returns the picture and a short text line; `meta` becomes structuredContent. */
const IMAGE = Symbol('mcpImage')
export interface ImageResult { [IMAGE]: true; data: string; mimeType: string; meta: Record<string, unknown> }
export function imageResult(data: string, mimeType: string, meta: Record<string, unknown>): ImageResult {
  return { [IMAGE]: true, data, mimeType, meta }
}
const isImage = (v: unknown): v is ImageResult => !!v && typeof v === 'object' && (v as Record<symbol, unknown>)[IMAGE] === true

/** `client` is the agent's name from its key. `clientInfo` is what the program called itself (display only, not trusted). */
export interface McpSession { client: string; agentId: string; clientInfo?: string }

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const INSTRUCTIONS = 'Talaria is a browser on this Mac. The person\'s own bookmarks, history, pins and open windows are read-only: you cannot change or delete them, except that you can set up pins. To save pages, make your own folder with create_bookmark_folder and use add_bookmark. Only the folder\'s owner can add to it, and removing pages needs the folder\'s allowDelete on. Use open_window to show the person a web page in a new window. You can close only windows you opened, and you cannot delete pins (you can turn a window into a pin, rename a pin, and archive or unarchive it).'

type Id = string | number | null

const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result })
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Check an argument that must be text. Returns '' when it is missing and not required. */
export function str(args: Record<string, unknown>, key: string, max: number, required = false): string {
  const v = args[key]
  if (v === undefined || v === null) {
    if (required) throw new Error(`"${key}" is required`)
    return ''
  }
  if (typeof v !== 'string') throw new Error(`"${key}" must be text`)
  if (v.length > max) throw new Error(`"${key}" is too long (at most ${max} characters)`)
  return v
}

/** Check an argument that must be a whole number between min and max. */
export function int(args: Record<string, unknown>, key: string, def: number, min: number, max: number): number {
  const v = args[key]
  if (v === undefined || v === null) return def
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`"${key}" must be a whole number`)
  if (v < min || v > max) throw new Error(`"${key}" must be between ${min} and ${max}`)
  return v
}

/** Check an argument that must be true or false. */
export function bool(args: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = args[key]
  if (v === undefined || v === null) return def
  if (typeof v !== 'boolean') throw new Error(`"${key}" must be true or false`)
  return v
}

/** The arguments as short text for the activity log: each string cut to 120 characters, the whole to 400. */
export function shortArgs(args: Record<string, unknown>): string {
  const text = JSON.stringify(args, (_key, v) => (typeof v === 'string' && v.length > 120 ? v.slice(0, 120) : v)) ?? '{}'
  return text.slice(0, 400)
}

const SWITCHED_OFF = 'This kind of tool is switched off in Talaria (Settings > Agents).'

export function createMcpHandler(opts: {
  name: string
  version: string
  tools: () => McpTool[]
  /** Return false to hide a tool and refuse calls to it. */
  allowed?: (tool: McpTool) => boolean
  /** Told after every call to a tool that changes something. */
  onChange?: (entry: ActivityEntry) => void
}) {
  const isAllowed = (t: McpTool) => !opts.allowed || opts.allowed(t)

  async function callTool(params: Record<string, unknown>, session: McpSession): Promise<unknown> {
    const tool = opts.tools().find((t) => t.name === params.name)
    if (!tool) throw new RpcError(-32602, `Unknown tool: ${String(params.name)}`)
    if (!isAllowed(tool)) return { content: [{ type: 'text', text: SWITCHED_OFF }], isError: true }
    const args = isObject(params.arguments) ? params.arguments : {}
    const log = (okay: boolean, message: string, undo?: { key: string; value: unknown }) => {
      if (!tool.changes || !opts.onChange) return
      try { opts.onChange({ time: Date.now(), agent: session.client, tool: tool.name, args: shortArgs(tool.logArgs ? tool.logArgs(args) : args), ok: okay, message: message.slice(0, 200), ...(undo ? { undo } : {}) }) } catch { /* the log must not break a call */ }
    }
    try {
      const value = await tool.run(args, { client: session.client, agentId: session.agentId })
      let undo: { key: string; value: unknown } | undefined
      try { undo = tool.undo?.(value) } catch { /* no undo is better than a broken call */ }
      log(true, '', undo)
      if (isImage(value)) {
        return { content: [{ type: 'image', data: value.data, mimeType: value.mimeType }, { type: 'text', text: JSON.stringify(value.meta) }], structuredContent: value.meta }
      }
      const structured = isObject(value) ? value : { result: value }
      return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: structured }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      log(false, text)
      return { content: [{ type: 'text', text }], isError: true }
    }
  }

  async function one(message: unknown, session: McpSession): Promise<object | null> {
    if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      const id = isObject(message) && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null
      return fail(id, -32600, 'Invalid request')
    }
    if (message.id === undefined) return null // a notification: no answer
    const id = message.id as Id
    const params = isObject(message.params) ? message.params : {}
    try {
      switch (message.method) {
        case 'initialize': {
          const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
          const info = isObject(params.clientInfo) ? params.clientInfo : {}
          const name = typeof info.name === 'string' ? info.name.trim().slice(0, 60) : ''
          session.clientInfo = name || undefined
          return ok(id, {
            protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: opts.name, version: opts.version },
            instructions: INSTRUCTIONS
          })
        }
        case 'ping': return ok(id, {})
        case 'tools/list': return ok(id, { tools: opts.tools().filter(isAllowed).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
        case 'tools/call': return ok(id, await callTool(params, session))
        default: return fail(id, -32601, `Method not found: ${message.method}`)
      }
    } catch (error) {
      if (error instanceof RpcError) return fail(id, error.code, error.message)
      return fail(id, -32603, 'Internal error')
    }
  }

  return {
    async handle(message: unknown, session: McpSession): Promise<object | object[] | null> {
      if (Array.isArray(message)) {
        if (message.length === 0) return fail(null, -32600, 'Invalid request')
        const answers = (await Promise.all(message.map((m) => one(m, session)))).filter((a): a is object => a !== null)
        return answers.length ? answers : null
      }
      return one(message, session)
    }
  }
}

class RpcError extends Error {
  constructor(readonly code: number, message: string) { super(message) }
}
