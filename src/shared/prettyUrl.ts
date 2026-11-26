/** The short text shown on the address label: the site and the path, no "www", no search words. */
export function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    const path = u.pathname === '/' ? '' : decodeURIComponent(u.pathname)
    return u.host.replace(/^www\./i, '') + path
  } catch {
    return ''
  }
}

export function isSecureUrl(url: string): boolean {
  return url.startsWith('https://')
}
