/** Pure logic for "this agent may click and type on this site". No Electron and no files here. */

export interface SiteApproval { agentId: string; agentName: string; origin: string }

const MAX_APPROVALS = 500

/** The origin of an http or https address, or null for anything else (about:, file:, chrome: and so on). */
export function actOrigin(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch { return null }
}

export const isApproved = (list: SiteApproval[], agentId: string, origin: string): boolean =>
  list.some((a) => a.agentId === agentId && a.origin === origin)

/** The list with one more approval. The same agent and site is kept once (the name is refreshed). */
export function recordApproval(list: SiteApproval[], entry: SiteApproval): SiteApproval[] {
  const rest = list.filter((a) => !(a.agentId === entry.agentId && a.origin === entry.origin))
  return [...rest, { agentId: entry.agentId, agentName: entry.agentName, origin: entry.origin }].slice(-MAX_APPROVALS)
}

export const removeApproval = (list: SiteApproval[], agentId: string, origin: string): SiteApproval[] =>
  list.filter((a) => !(a.agentId === agentId && a.origin === origin))

/** For the settings list: sorted by agent name, then origin. */
export const listApprovals = (list: SiteApproval[]): SiteApproval[] =>
  [...list].sort((a, b) => a.agentName.localeCompare(b.agentName) || a.origin.localeCompare(b.origin))

/** Read the file contents. Anything that is not the expected shape gives an empty list, bad entries are dropped. */
export function parseApprovals(raw: unknown): SiteApproval[] {
  const items = raw && typeof raw === 'object' ? (raw as { approvals?: unknown }).approvals : undefined
  if (!Array.isArray(items)) return []
  let out: SiteApproval[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const { agentId, agentName, origin } = item as Record<string, unknown>
    if (typeof agentId !== 'string' || !agentId || agentId.length > 100) continue
    if (typeof agentName !== 'string' || agentName.length > 100) continue
    if (typeof origin !== 'string' || origin.length > 300 || actOrigin(origin) !== origin) continue
    out = recordApproval(out, { agentId, agentName, origin })
  }
  return out
}

export const serializeApprovals = (list: SiteApproval[]): string => JSON.stringify({ version: 1, approvals: list }, null, 2) + '\n'
