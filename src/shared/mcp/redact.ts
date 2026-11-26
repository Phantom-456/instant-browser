/**
 * Hide likely passwords and API keys in what an agent reads from a page. Pure code, no Electron.
 * It cannot see secrets drawn in images or canvas, and it only knows common key formats and labelled values.
 */

export const HIDDEN = '[hidden secret]'

/** Well-known key formats. */
export const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/g
]

/** A label, then : or =, then a value of 12 or more characters. Group 1 is the label part, group 2 the value. */
export const LABELLED_SECRET = /\b((?:api[ _-]?key|apikey|secret|token|access[ _-]?key|client[ _-]?secret|password|passwd)["']?\s*[:=]\s*["']?)([^\s"']{12,})/gi

/** Replace likely secrets with "[hidden secret]". Returns the new text and how many were replaced. */
export function redactSecrets(text: string): { text: string; count: number } {
  if (typeof text !== 'string' || !text) return { text: typeof text === 'string' ? text : '', count: 0 }
  let count = 0
  let out = text.replace(LABELLED_SECRET, (m, label: string, value: string) => {
    if (value.startsWith('[hidden')) return m
    count++
    return label + HIDDEN
  })
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p, () => { count++; return HIDDEN })
  }
  return { text: out, count }
}

const SECRET_PARAM = /^(?:key|api[_-]?key|apikey|token|access[_-]?token|secret|sig|signature|password|auth|code|session)$/i

/** Remove secret-looking query values and user:password@ from an address. Not valid addresses come back through redactSecrets. */
export function redactUrl(url: string): { url: string; count: number } {
  let u: URL
  try { u = new URL(url) } catch {
    const r = redactSecrets(url)
    return { url: r.text, count: r.count }
  }
  let count = 0
  if (u.username || u.password) { u.username = ''; u.password = ''; count++ }
  for (const [name, value] of Array.from(u.searchParams.entries())) {
    if (SECRET_PARAM.test(name) && value !== '') { u.searchParams.set(name, '[hidden]'); count++ }
  }
  if (count === 0) {
    const r = redactSecrets(url)
    return { url: r.text, count: r.count }
  }
  const r = redactSecrets(u.toString().replace(/%5B/gi, '[').replace(/%5D/gi, ']'))
  return { url: r.text, count: count + r.count }
}

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Paint rectangles solid black on a BGRA bitmap, in place. Rects are in CSS pixels and `scale` is image pixels per CSS pixel.
 * Rects are clamped to the picture. Returns how many rects had any part inside it.
 */
export function blackOutRects(bitmap: Buffer, width: number, height: number, rects: Rect[], scale: number): number {
  if (!(width > 0) || !(height > 0) || !(scale > 0) || bitmap.length < width * height * 4) return 0
  let painted = 0
  for (const r of rects) {
    if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) continue
    const x0 = Math.max(0, Math.floor(r.x * scale) - 1)
    const y0 = Math.max(0, Math.floor(r.y * scale) - 1)
    const x1 = Math.min(width, Math.ceil((r.x + r.width) * scale) + 1)
    const y1 = Math.min(height, Math.ceil((r.y + r.height) * scale) + 1)
    if (x1 <= x0 || y1 <= y0) continue
    for (let y = y0; y < y1; y++) {
      const row = y * width * 4
      for (let x = x0; x < x1; x++) {
        const i = row + x * 4
        bitmap[i] = 0; bitmap[i + 1] = 0; bitmap[i + 2] = 0; bitmap[i + 3] = 255
      }
    }
    painted++
  }
  return painted
}
