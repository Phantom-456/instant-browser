/** How many suggestions the search bar shows. */
export const MAX_SUGGESTIONS = 7

/**
 * The address that gives suggestions for the user's search engine, or null when we do not know one.
 * The suggestions come from the same company as the search, and only if the user left them on.
 */
export function suggestEndpoint(searchTemplate: string, text: string): string | null {
  const query = text.trim()
  if (!query) return null
  let host: string
  try {
    host = new URL(searchTemplate.replace('%s', 'x')).hostname.toLowerCase()
  } catch {
    return null
  }
  const q = encodeURIComponent(query)
  if (host === 'google.com' || host.endsWith('.google.com')) {
    return `https://suggestqueries.google.com/complete/search?client=firefox&q=${q}`
  }
  if (host === 'duckduckgo.com') return `https://duckduckgo.com/ac/?q=${q}&type=list`
  if (host === 'bing.com' || host.endsWith('.bing.com')) return `https://api.bing.com/osjson.aspx?query=${q}`
  return null
}

/** Read the common "OpenSearch" answer: ["text", ["suggestion", ...]]. */
export function parseSuggestions(json: unknown): string[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return []
  const seen = new Set<string>()
  for (const item of json[1] as unknown[]) {
    if (typeof item === 'string' && item.trim()) seen.add(item.trim())
    if (seen.size >= MAX_SUGGESTIONS) break
  }
  return [...seen]
}
