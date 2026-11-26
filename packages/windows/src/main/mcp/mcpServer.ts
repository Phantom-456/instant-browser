import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { McpSession } from '../../shared/mcp/protocol'

const MAX_BODY = 1024 * 1024
const MAX_SESSIONS = 64

interface Handler { handle(message: unknown, session: McpSession): Promise<object | object[] | null> }

/** `auth` finds the agent that owns a key, or null. */
export interface McpServerDeps { auth: (key: string) => { id: string; name: string } | null; handler: Handler }

/** The MCP server: plain HTTP on this computer only (127.0.0.1). Every request needs an agent's key. */
export class McpServer {
  private server: Server | null = null
  private boundPort = 0
  private readonly sessions = new Map<string, McpSession>()

  constructor(private readonly deps: McpServerDeps) {}

  running(): boolean { return this.server !== null }
  port(): number { return this.boundPort }

  start(port: number): Promise<'ok' | 'in-use' | 'error'> {
    if (this.server) return Promise.resolve('ok')
    return new Promise((resolve) => {
      const server = createServer((req, res) => { void this.onRequest(req, res) })
      server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EADDRINUSE' ? 'in-use' : 'error'))
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error')
        server.on('error', () => {})
        this.server = server
        const address = server.address()
        this.boundPort = typeof address === 'object' && address ? address.port : port
        resolve('ok')
      })
    })
  }

  stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.boundPort = 0
    this.sessions.clear()
    if (!server) return Promise.resolve()
    return new Promise((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  private send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
    const text = body === undefined ? '' : JSON.stringify(body)
    res.writeHead(status, { ...(text ? { 'Content-Type': 'application/json' } : {}), 'Content-Length': Buffer.byteLength(text), ...headers })
    res.end(text)
  }

  private rpcError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
    this.send(res, status, { jsonrpc: '2.0', id: null, error: { code, message } }, headers)
  }

  /** The agent whose key this request carries, or null. */
  private authenticate(req: IncomingMessage): { id: string; name: string } | null {
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
    return given ? this.deps.auth(given) : null
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.headers.origin !== undefined) return this.send(res, 403) // a web page is calling: never allowed
      const host = req.headers.host
      if (host !== `127.0.0.1:${this.boundPort}` && host !== `localhost:${this.boundPort}`) return this.send(res, 403) // stops DNS rebinding
      const path = (req.url ?? '').split('?')[0]
      if (path !== '/mcp') return this.send(res, 404)
      if (req.method !== 'POST') return this.send(res, 405, undefined, { Allow: 'POST' })
      const agent = this.authenticate(req)
      if (!agent) return this.send(res, 401, undefined, { 'WWW-Authenticate': 'Bearer' })
      const body = await readBody(req)
      if (body === null) return this.send(res, 413)
      let message: unknown
      try { message = JSON.parse(body) } catch { return this.rpcError(res, 400, -32700, 'Parse error') }
      const id = req.headers['mcp-session-id']
      let known = typeof id === 'string' ? this.sessions.get(id) : undefined
      if (known && known.agentId !== agent.id) known = undefined // another agent's session: never reused
      if (known) known.client = agent.name // the agent's name comes from its key
      const session: McpSession = known ?? { client: agent.name, agentId: agent.id }
      const answer = await this.deps.handler.handle(message, session)
      const headers: Record<string, string> = {}
      if (!known && answersInitialize(message)) headers['Mcp-Session-Id'] = this.remember(session)
      if (answer === null) return this.send(res, 202, undefined, headers)
      this.send(res, 200, answer, headers)
    } catch {
      if (!res.headersSent) this.rpcError(res, 500, -32603, 'Internal error')
    }
  }

  private remember(session: McpSession): string {
    const id = randomUUID()
    this.sessions.set(id, session)
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string)
    return id
  }
}

function answersInitialize(message: unknown): boolean {
  const first = Array.isArray(message) ? message[0] : message
  return !!first && typeof first === 'object' && (first as { method?: unknown }).method === 'initialize'
}

/** The whole body as text, or null when it is over the limit. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) { resolve(null); req.removeAllListeners('data'); req.resume(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
