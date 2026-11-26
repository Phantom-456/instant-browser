/** What kind of address a page has, so the lists can show local files and site types apart. */
export type SiteKind = 'file' | 'local' | 'secure' | 'plain' | 'other'

export function siteKind(url: string): SiteKind {
  let u: URL
  try { u = new URL(url) } catch { return 'other' }
  if (u.protocol === 'file:') return 'file'
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'other'
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]') return 'local'
  return u.protocol === 'https:' ? 'secure' : 'plain'
}

export const SITE_KIND_TEXT: Record<SiteKind, string> = {
  file: 'Local file',
  local: 'This computer or home network',
  secure: 'Website (https)',
  plain: 'Website (not encrypted)',
  other: 'Other'
}
