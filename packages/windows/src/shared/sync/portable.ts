import type { Settings } from '../settings'
import type { GradientSpec, PinRecord } from '../pins/model'

/**
 * What may leave this computer when sync is on (Alpha 04). Everything else stays local.
 *
 * Synced: a pin's address, title, custom name, colours (seed and stops), and whether it is archived.
 * NOT synced: where the pin or its window was on screen, desktop ids, the saved picture, scroll, page state,
 * cookies, passwords, tokens, site storage, history (history needs its own opt-in and is not in this file).
 */

export const SYNC_VERSION = 1

export interface SyncPin {
  id: string
  url: string
  title: string
  label: string | null
  gradient: GradientSpec
  archived: boolean
  createdAt: number
}

/** The settings that make sense on another computer. Device things (hotkey, folders, browser choice) are left out. */
export const PORTABLE_PREF_KEYS = [
  'searchTemplate', 'httpsFirst', 'sendGpc', 'showSuggestions', 'defaultZoom', 'pinSize', 'maxPins',
  'autoOffloadInactivity', 'autoOffloadMinutes', 'autoOffloadMemory', 'autoOffloadMemoryGB', 'memoryAsk'
] as const satisfies ReadonlyArray<keyof Settings>
export type PortablePrefKey = (typeof PORTABLE_PREF_KEYS)[number]

export function toSyncPin(pin: PinRecord): SyncPin {
  return { id: pin.id, url: pin.url, title: pin.title, label: pin.label, gradient: pin.gradient, archived: pin.archived, createdAt: pin.createdAt }
}

export function portablePrefs(settings: Settings): Partial<Pick<Settings, PortablePrefKey>> {
  const out: Record<string, unknown> = {}
  for (const key of PORTABLE_PREF_KEYS) out[key] = settings[key]
  return out as Partial<Pick<Settings, PortablePrefKey>>
}

/** A pin that came from another computer, as a local record: released, placed by the receiving computer. */
export function fromSyncPin(pin: SyncPin, place: { x: number; y: number }, now: number): PinRecord {
  return {
    id: pin.id, url: pin.url, title: pin.title, label: pin.label, icon: null, state: 'offloaded', archived: pin.archived,
    archivedAt: pin.archived ? now : null, following: false, gradient: pin.gradient,
    window: { x: place.x, y: place.y, width: 480, height: 640 }, anchor: null, pin: place, scroll: null, snapshotAt: null,
    createdAt: pin.createdAt, lastUsedAt: now, restoredAt: null
  }
}
