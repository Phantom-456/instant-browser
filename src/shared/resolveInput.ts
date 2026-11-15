export const DEFAULT_SEARCH = 'https://www.google.com/search?q=%s'

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const LOCAL_HOST = /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i

/** Turn what the user typed into a URL to load. null means "nothing to load". */
export function resolveInput(raw: string, searchTemplate: string = DEFAULT_SEARCH): string | null {
  const text = raw.trim()
  if (!text) return null
  if (HAS_SCHEME.test(text)) return /^https?:\/\//i.test(text) ? text : null
  if (!/\s/.test(text)) {
    if (LOCAL_HOST.test(text)) return `http://${text}`
    if (DOMAIN.test(text)) return `https://${text}`
  }
  return searchTemplate.replace('%s', encodeURIComponent(text))
}
