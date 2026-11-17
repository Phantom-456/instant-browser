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

const LABELS: Record<string, string> = {
  media: 'use your camera or microphone',
  geolocation: 'know your location',
  notifications: 'show notifications',
  'clipboard-read': 'read what you copied'
}

export function permissionLabel(permission: string): string {
  return LABELS[permission] ?? `use "${permission}"`
}
