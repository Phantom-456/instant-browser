import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A small pretend Google for tests: the sign-in page, the token address, and the app data folder of Drive (one folder, files
 * with a version number that goes up at every write). It checks the same things the real one checks: the PKCE verifier must
 * match the challenge, and every Drive call needs the access token.
 */
export interface FakeGoogle {
  base: string
  server: Server
  files: Map<string, { id: string; name: string; body: string; version: number }>
  log: string[]
  /** Pretend the network is down (answer 503). */
  down: boolean
  /** Make the next /token refresh answer invalid_grant (the person removed the permission). */
  revokeLogin: boolean
  close(): Promise<void>
}

const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolve) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => resolve(t)) })

export async function startFakeGoogle(): Promise<FakeGoogle> {
  const { createHash } = await import('node:crypto')
  const fake: FakeGoogle = { base: '', server: null as unknown as Server, files: new Map(), log: [], down: false, revokeLogin: false, close: async () => {} }
  const challenges = new Map<string, string>() // code -> challenge
  let n = 0
  const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

  fake.server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    fake.log.push(`${req.method} ${url.pathname}`)
    if (fake.down && url.pathname !== '/auth') return json(res, 503, { error: 'down' })

    if (url.pathname === '/auth') { // the sign-in page: the person says yes, Google sends them back with a code
      const code = `code-${++n}`
      challenges.set(code, url.searchParams.get('code_challenge') ?? '')
      const back = new URL(url.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', code)
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      res.writeHead(302, { location: back.toString() }).end()
      return
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(await readBody(req))
      if (form.get('grant_type') === 'authorization_code') {
        const expected = challenges.get(form.get('code') ?? '')
        const actual = form.get('code_verifier') ? createHash('sha256').update(form.get('code_verifier')!).digest('base64url') : ''
        if (!expected || expected !== actual) return json(res, 400, { error: 'invalid_grant' })
        return json(res, 200, { access_token: `access-${++n}`, refresh_token: 'refresh-1', expires_in: 3600 })
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (fake.revokeLogin) return json(res, 400, { error: 'invalid_grant' })
        return json(res, 200, { access_token: `access-${++n}`, expires_in: 3600 })
      }
      return json(res, 400, { error: 'unsupported_grant_type' })
    }
    if (url.pathname === '/revoke') return json(res, 200, {})

    // Drive: every call needs a token
    if (!(req.headers.authorization ?? '').startsWith('Bearer access-')) return json(res, 401, { error: 'unauthorized' })
    if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      const name = /name = '([^']+)'/.exec(q)?.[1]
      const files = [...fake.files.values()].filter((f) => !name || f.name === name).map((f) => ({ id: f.id, version: String(f.version) }))
      return json(res, 200, { files })
    }
    const media = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)
    if (media && req.method === 'GET') {
      const f = fake.files.get(decodeURIComponent(media[1]!))
      return f ? res.writeHead(200, { 'content-type': 'application/json' }).end(f.body) : json(res, 404, {})
    }
    if (media && req.method === 'DELETE') { fake.files.delete(decodeURIComponent(media[1]!)); return res.writeHead(204).end() }
    if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
      const text = await readBody(req)
      const meta = /\r\n\r\n(\{[^\r]*\})\r\n--/.exec(text)?.[1] ?? '{}'
      const body = /content-type: application\/json\r\n\r\n([\s\S]*)\r\n--[^\r]*--\s*$/.exec(text)?.[1] ?? ''
      const m = JSON.parse(meta) as { name: string; parents?: string[] }
      if (m.parents?.[0] !== 'appDataFolder') return json(res, 400, { error: 'only the app data folder' })
      const id = `file-${++n}`
      fake.files.set(id, { id, name: m.name, body, version: 1 })
      return json(res, 200, { id })
    }
    const upload = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)
    if (upload && req.method === 'PATCH') {
      const f = fake.files.get(decodeURIComponent(upload[1]!))
      if (!f) return json(res, 404, {})
      f.body = await readBody(req)
      f.version++
      return json(res, 200, { id: f.id })
    }
    return json(res, 404, { error: 'unknown' })
  })
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve))
  fake.base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`
  fake.close = () => new Promise<void>((resolve) => { fake.server.closeAllConnections?.(); fake.server.close(() => resolve()) })
  return fake
}
