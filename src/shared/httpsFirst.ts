/** Hosts on this computer or the home/office network. They often have no https. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '[::1]') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/** The https address to try first, or null when the URL should load as it is. */
export function httpsUpgrade(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' || u.port || isLocalHost(u.hostname)) return null
    u.protocol = 'https:'
    return u.toString()
  } catch {
    return null
  }
}

/** The http address to offer when the https try failed. */
export function httpFallback(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    u.protocol = 'http:'
    return u.toString()
  } catch {
    return null
  }
}
