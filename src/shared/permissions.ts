/** Permissions the user is asked about. Every other permission is denied without asking. */
export const PROMPT_PERMISSIONS: readonly string[] = ['media', 'geolocation', 'notifications', 'clipboard-read']

export type Decision = 'allow' | 'deny'
export interface SavedPermission { origin: string; permission: string; decision: Decision }

export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

export function findDecision(saved: SavedPermission[], origin: string, permission: string): Decision | null {
  return saved.find((s) => s.origin === origin && s.permission === permission)?.decision ?? null
}

export function withoutDecision(saved: SavedPermission[], origin: string, permission: string): SavedPermission[] {
  return saved.filter((s) => !(s.origin === origin && s.permission === permission))
}

export function withDecision(saved: SavedPermission[], entry: SavedPermission): SavedPermission[] {
  return [...withoutDecision(saved, entry.origin, entry.permission), entry]
}

/**
 * What a decision is saved under. Camera and microphone are saved apart ('media:video', 'media:audio'): a site that was
 * allowed the microphone must not get the camera later without asking. No media type given: both (the safe side).
 */
export function permissionKeys(permission: string, mediaTypes?: readonly string[]): string[] {
  if (permission !== 'media') return [permission]
  const keys = [...new Set((mediaTypes ?? []).filter((t) => t === 'audio' || t === 'video'))].sort().map((t) => `media:${t}`)
  return keys.length ? keys : ['media:audio', 'media:video']
}

/** The saved decision for every key: denied if any is denied, allowed only if all are allowed, otherwise ask.
 * An entry saved as plain 'media' by an older version counts for both camera and microphone. */
export function savedDecision(saved: SavedPermission[], origin: string, keys: readonly string[]): Decision | null {
  const each = keys.map((k) => findDecision(saved, origin, k) ?? (k.startsWith('media:') ? findDecision(saved, origin, 'media') : null))
  if (each.includes('deny')) return 'deny'
  return each.length > 0 && each.every((d) => d === 'allow') ? 'allow' : null
}

const LABELS: Record<string, string> = {
  media: 'use your camera or microphone',
  'media:audio': 'use your microphone',
  'media:video': 'use your camera',
  geolocation: 'know your location',
  notifications: 'show notifications',
  'clipboard-read': 'read what you copied'
}

export function permissionLabel(permission: string): string {
  return LABELS[permission] ?? `use "${permission}"`
}

/** The prompt text for one request: "use your microphone", "use your camera and microphone". */
export function requestLabel(keys: readonly string[]): string {
  if (keys.length === 2 && keys.includes('media:audio') && keys.includes('media:video')) return 'use your camera and microphone'
  return keys.map(permissionLabel).join(' and ')
}
