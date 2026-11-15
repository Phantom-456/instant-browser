import { net } from 'electron'
import { parseSuggestions, suggestEndpoint } from '../shared/suggest'
import type { SettingsFile } from './settingsFile'

/** Ask the user's search engine for suggestions. Returns [] when off, unknown, offline or too slow. */
export async function fetchSuggestions(settings: SettingsFile, text: unknown): Promise<string[]> {
  const s = settings.get()
  if (!s.showSuggestions || typeof text !== 'string' || text.length > 200) return []
  const url = suggestEndpoint(s.searchTemplate, text)
  if (!url) return []
  try {
    // No cookies are sent or saved: suggestions must not link to a Google account.
    const response = await net.fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(2500) })
    if (!response.ok) return []
    return parseSuggestions(await response.json())
  } catch {
    return []
  }
}
