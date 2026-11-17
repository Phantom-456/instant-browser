import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

export const LOCAL_SCHEME = 'instant-local'
export function localPath(raw: string): string {
  let text = raw.trim().replace(/^(["'])(.*)\1$/, '$2')
  if (/^file:/i.test(text)) text = fileURLToPath(text)
  if (text.startsWith('~/')) text = resolve(homedir(), text.slice(2))
  if (!isAbsolute(text)) throw new Error('Use an absolute local file path.')
  return resolve(text)
}
export async function localTarget(raw: string): Promise<{ path: string; root: string }> {
  const path = await realpath(localPath(raw))
  if (!(await stat(path)).isFile() || !/\.(html?|md|markdown)$/i.test(path)) {
    throw new Error('Choose an HTML (.html, .htm) or Markdown (.md, .markdown) file.')
  }
  return { path, root: dirname(path) }
}
const within = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
const mime: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg'
}
export function markdownPage(source: string): string {
  const body = sanitizeHtml(marked.parse(source, { async: false }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ['src', 'alt', 'title', 'width', 'height'] },
    allowedSchemes: ['https', 'http', LOCAL_SCHEME], allowProtocolRelative: false
  })
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Markdown</title><style>
  :root{color-scheme:light dark}body{font:17px/1.65 system-ui,sans-serif;max-width:850px;margin:40px auto;padding:0 24px;overflow-wrap:anywhere}img{max-width:100%}pre{overflow:auto;padding:16px;background:light-dark(#f3f3f5,#242427);border-radius:8px}code{font-family:ui-monospace,monospace}table{border-collapse:collapse}td,th{border:1px solid GrayText;padding:8px}blockquote{border-left:3px solid GrayText;margin-left:0;padding-left:18px}
  </style></head><body>${body}</body></html>`
}
/** One grant per window. Nothing is persisted; revoke before destroying the window. */
export class LocalFileGrant {
  private active = true
  constructor(readonly root: string, readonly host: string) {}
  url(path: string): string {
    if (!within(this.root, path)) throw new Error('File is outside the approved folder.')
    return `${LOCAL_SCHEME}://${this.host}/${relative(this.root, path).split(sep).map(encodeURIComponent).join('/')}`
  }
  allows(url: string): boolean {
    try { const u = new URL(url); return this.active && u.protocol === `${LOCAL_SCHEME}:` && u.host === this.host && !u.username && !u.password } catch { return false }
  }
  displayPath(url: string): string {
    if (!this.allows(url)) return url
    try { return resolve(this.root, `.${decodeURIComponent(new URL(url).pathname)}`) } catch { return url }
  }
  revoke(): void { this.active = false }
  async respond(request: { url: string; method: string }): Promise<Response> {
    if (!this.allows(request.url) || !['GET', 'HEAD'].includes(request.method)) return new Response('Access denied', { status: 403 })
    try {
      const u = new URL(request.url)
      const decoded = decodeURIComponent(u.pathname)
      if (decoded.includes('\\') || decoded.includes('\0')) throw new Error('Invalid path')
      const candidate = resolve(this.root, `.${decoded}`)
      if (!within(this.root, candidate)) throw new Error('Outside folder')
      const canonical = await realpath(candidate)
      if (!within(this.root, canonical)) throw new Error('Symlink outside folder')
      const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW)
      let data: Buffer
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Not a supported file')
        data = await handle.readFile()
      } finally { await handle.close() }
      if (!this.active) return new Response('Access expired', { status: 403 })
      const md = /\.(md|markdown)$/i.test(canonical)
      const headers: Record<string, string> = { 'Content-Type': md ? 'text/html; charset=utf-8' : mime[extname(canonical).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      if (md) headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: http:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"
      return new Response(request.method === 'HEAD' ? null : md ? markdownPage(data.toString('utf8')) : new Uint8Array(data), { headers })
    } catch { return new Response('File unavailable or outside the approved folder.', { status: 403 }) }
  }
}
