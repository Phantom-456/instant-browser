import { session } from 'electron'
import { suggestEndpoint } from '../shared/suggest'
import type { SettingsFile } from './settingsFile'
import { getWebSession } from './webSession'
import { perf } from './perf'

function originOf(url: string | null): string | null {
  try { return url ? new URL(url).origin : null } catch { return null }
}

/**
 * Get ready for the first search: open the connection to the search engine before it is needed
 * (the lookup of its address, the secure handshake), and open the cookie store of the web session now,
 * instead of during the first page load. Cheap, so it can run again each time the search bar opens.
 */
export function warmNetwork(settings: SettingsFile): void {
  const template = settings.get().searchTemplate
  const search = originOf(template.replace('%s', 'x'))
  const suggestions = originOf(suggestEndpoint(template, 'x'))
  try {
    const web = getWebSession()
    if (search) {
      web.preconnect({ url: search, numSockets: 2 })
      void web.cookies.get({ url: search }).catch(() => {}) // opens the cookie store (and its encryption key) now
    }
    // Suggestions are fetched with the default session.
    if (suggestions) session.defaultSession.preconnect({ url: suggestions, numSockets: 1 })
    perf('network: warmed', `${search ?? '-'} ${suggestions ?? '-'}`)
  } catch {
    // warming is only an optimisation
  }
}
