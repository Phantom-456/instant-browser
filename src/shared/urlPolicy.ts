/** Only web pages may load in a mini window. */
export function isAllowedUrl(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
