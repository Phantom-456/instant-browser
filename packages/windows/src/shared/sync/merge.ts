import { PORTABLE_PREF_KEYS, SYNC_VERSION, type PortablePrefKey, type SyncPin } from './portable'

/**
 * The shared document in the user's Drive app folder. Every item carries the time of its last change and the device
 * that made it, so two computers can merge without a server. Rules:
 *  - The newest change to an item wins. On the same millisecond the larger device id wins (any fixed rule will do).
 *  - A deletion is a tombstone. It wins over an older change; a change made AFTER the deletion brings the item back.
 *  - Tombstones are kept 90 days, so a computer that was off for weeks does not bring deleted pins back.
 *  - Pins are the same pin only when their ids are equal. Two pins of one site stay two pins.
 */

export const TOMBSTONE_DAYS = 90
const DAY = 86_400_000

export interface Stamp { updatedAt: number; device: string }
export interface PinEntry extends Stamp { pin: SyncPin }
export interface PrefEntry extends Stamp { value: unknown }
export interface Tombstone extends Stamp { id: string }

export interface SyncDoc {
  version: number
  pins: Record<string, PinEntry>
  prefs: Partial<Record<PortablePrefKey, PrefEntry>>
  tombstones: Record<string, Tombstone>
}

export const emptyDoc = (): SyncDoc => ({ version: SYNC_VERSION, pins: {}, prefs: {}, tombstones: {} })

/** Is a newer than b? */
export const newer = (a: Stamp, b: Stamp): boolean => a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.device > b.device)

/** Read a document from outside: anything wrong is dropped, never trusted. */
export function parseDoc(raw: unknown): SyncDoc {
  const r = raw as Partial<SyncDoc> | null
  const doc = emptyDoc()
  if (!r || typeof r !== 'object' || r.version !== SYNC_VERSION) return doc
  const stamp = (v: unknown): v is Stamp => !!v && typeof v === 'object' && Number.isFinite((v as Stamp).updatedAt) && typeof (v as Stamp).device === 'string'
  for (const [id, e] of Object.entries(r.pins ?? {})) {
    const entry = e as PinEntry
    if (stamp(entry) && entry.pin && typeof entry.pin.url === 'string' && entry.pin.id === id) doc.pins[id] = entry
  }
  for (const key of PORTABLE_PREF_KEYS) {
    const e = (r.prefs ?? {})[key] as PrefEntry | undefined
    if (stamp(e) && 'value' in e) doc.prefs[key] = e
  }
  for (const [id, t] of Object.entries(r.tombstones ?? {})) if (stamp(t) && (t as Tombstone).id === id) doc.tombstones[id] = t as Tombstone
  return doc
}

/** Merge two documents. The result does not depend on the order, and merging twice changes nothing. */
export function mergeDocs(a: SyncDoc, b: SyncDoc, now: number): SyncDoc {
  const out = emptyDoc()

  // Tombstones: the newest for each id; old ones are dropped.
  for (const t of [...Object.values(a.tombstones), ...Object.values(b.tombstones)]) {
    const old = out.tombstones[t.id]
    if (!old || newer(t, old)) out.tombstones[t.id] = t
  }
  for (const [id, t] of Object.entries(out.tombstones)) if (now - t.updatedAt > TOMBSTONE_DAYS * DAY) delete out.tombstones[id]

  // Pins: the newest entry wins, unless a newer tombstone removed it.
  for (const e of [...Object.values(a.pins), ...Object.values(b.pins)]) {
    const old = out.pins[e.pin.id]
    if (!old || newer(e, old)) out.pins[e.pin.id] = e
  }
  for (const [id, e] of Object.entries(out.pins)) {
    const t = out.tombstones[id]
    if (t && newer(t, e)) delete out.pins[id] // deleted after the last change
    else if (t) delete out.tombstones[id] // changed after the deletion: it is back
  }

  for (const key of PORTABLE_PREF_KEYS) {
    const x = a.prefs[key]
    const y = b.prefs[key]
    const pick = x && y ? (newer(x, y) ? x : y) : x ?? y
    if (pick) out.prefs[key] = pick
  }
  return out
}

// ---- Local changes ----

/** The pins that this device has now, as changes on top of the shared document. */
export function applyLocal(doc: SyncDoc, local: { pins: SyncPin[]; prefs: Partial<Record<PortablePrefKey, unknown>>; deleted: string[] }, device: string, now: number): SyncDoc {
  const out: SyncDoc = { version: doc.version, pins: { ...doc.pins }, prefs: { ...doc.prefs }, tombstones: { ...doc.tombstones } }
  for (const pin of local.pins) {
    const old = out.pins[pin.id]
    if (!old || JSON.stringify(old.pin) !== JSON.stringify(pin)) out.pins[pin.id] = { updatedAt: now, device, pin } // only real changes get a new time
  }
  for (const id of local.deleted) {
    delete out.pins[id]
    out.tombstones[id] = { id, updatedAt: now, device }
  }
  for (const key of PORTABLE_PREF_KEYS) {
    if (!(key in local.prefs)) continue
    const old = out.prefs[key]
    if (!old || JSON.stringify(old.value) !== JSON.stringify(local.prefs[key])) out.prefs[key] = { updatedAt: now, device, value: local.prefs[key] }
  }
  return out
}
