import { PORTABLE_PREF_KEYS, SYNC_VERSION, type PortablePrefKey, type SyncBookmark, type SyncDevice, type SyncHistoryItem, type SyncPin } from './portable'

/**
 * The shared document in the user's Drive app folder. Every item carries the time of its last change and the device
 * that made it, so two computers can merge without a server. Rules:
 *  - The newest change to an item wins. On the same millisecond the larger device id wins (any fixed rule will do).
 *  - A deletion is a tombstone. It wins over an older change; a change made AFTER the deletion brings the item back.
 *  - Tombstones are kept 90 days, so a computer that was off for weeks does not bring deleted pins back.
 *  - Pins are the same pin only when their ids are equal. Two pins of one site stay two pins.
 */

export const TOMBSTONE_DAYS = 90
/** A page removed from the history is a tombstone too, under this id. Its time is when it was removed: older visits stay gone. */
export const historyTombstoneId = (url: string): string => 'history:' + url
const DAY = 86_400_000

export interface Stamp { updatedAt: number; device: string }
export interface PinEntry extends Stamp { pin: SyncPin }
export interface PrefEntry extends Stamp { value: unknown }
export interface Tombstone extends Stamp { id: string }
export interface BookmarkEntry extends Stamp { bookmark: SyncBookmark }
export interface DeviceEntry extends SyncDevice { updatedAt: number }

/** Limits, so the shared file stays small. */
export const MAX_SYNC_HISTORY = 500
export const MAX_SYNC_BOOKMARKS = 5000
export const MAX_SYNC_DEVICES = 20
export const DEVICE_STALE_DAYS = 60

export interface SyncDoc {
  version: number
  pins: Record<string, PinEntry>
  prefs: Partial<Record<PortablePrefKey, PrefEntry>>
  tombstones: Record<string, Tombstone>
  /** One list of bookmarks for the whole account. A bookmark's id is made from its address, so the same page is one bookmark. */
  bookmarks: Record<string, BookmarkEntry>
  /** The app's own history, merged by address. */
  history: Record<string, SyncHistoryItem>
  /** History older than this was cleared (by any device) and must not come back. */
  historyClearedAt: number
  /** The pages each device has open, written only by that device. */
  devices: Record<string, DeviceEntry>
}

export const emptyDoc = (): SyncDoc => ({ version: SYNC_VERSION, pins: {}, prefs: {}, tombstones: {}, bookmarks: {}, history: {}, historyClearedAt: 0, devices: {} })

/** Is a newer than b? */
export const newer = (a: Stamp, b: Stamp): boolean => a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.device > b.device)

/**
 * Should entry a replace entry b? The newer one wins. Two different entries with the same time and device (two
 * computers that share a device id, for example after a Mac was copied with Migration Assistant) are ordered by their
 * content, so every computer picks the same one whatever order it merges in.
 */
const beats = (a: Stamp, b: Stamp): boolean => newer(a, b) || (!newer(b, a) && JSON.stringify(a) > JSON.stringify(b))
/** Sort helper: on equal values, the key decides, so cutting a list to its limit does not depend on the merge order. */
const byKey = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)

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
  for (const [id, e] of Object.entries(r.bookmarks ?? {})) {
    const entry = e as BookmarkEntry
    if (stamp(entry) && entry.bookmark && entry.bookmark.id === id && typeof entry.bookmark.url === 'string' && /^https?:/i.test(entry.bookmark.url)) {
      doc.bookmarks[id] = { updatedAt: entry.updatedAt, device: entry.device, bookmark: { id, url: entry.bookmark.url, title: String(entry.bookmark.title ?? '').slice(0, 300), createdAt: Number(entry.bookmark.createdAt) || 0 } }
    }
  }
  for (const [url, h] of Object.entries(r.history ?? {})) {
    const item = h as SyncHistoryItem
    if (item && typeof item.url === 'string' && item.url === url && /^https?:/i.test(url) && Number.isFinite(item.visits) && Number.isFinite(item.lastVisit)) doc.history[url] = { url, visits: Math.max(1, Math.round(item.visits)), lastVisit: item.lastVisit }
  }
  doc.historyClearedAt = Number.isFinite(r.historyClearedAt) ? Number(r.historyClearedAt) : 0
  for (const [id, d] of Object.entries(r.devices ?? {})) {
    const dev = d as DeviceEntry
    if (dev && typeof dev.name === 'string' && Number.isFinite(dev.updatedAt) && Array.isArray(dev.tabs)) {
      doc.devices[id] = {
        updatedAt: dev.updatedAt, name: dev.name.slice(0, 60),
        tabs: dev.tabs.filter((t) => t && typeof t.url === 'string' && /^https?:/i.test(t.url)).slice(0, 100).map((t) => ({ url: t.url, title: String(t.title ?? '').slice(0, 300), kind: t.kind === 'pin' ? 'pin' as const : 'window' as const }))
      }
    }
  }
  return doc
}

/** Merge two documents. The result does not depend on the order, and merging twice changes nothing. */
export function mergeDocs(a: SyncDoc, b: SyncDoc, now: number): SyncDoc {
  const out = emptyDoc()

  // Tombstones: the newest for each id; old ones are dropped.
  for (const t of [...Object.values(a.tombstones), ...Object.values(b.tombstones)]) {
    const old = out.tombstones[t.id]
    if (!old || beats(t, old)) out.tombstones[t.id] = t
  }
  for (const [id, t] of Object.entries(out.tombstones)) if (now - t.updatedAt > TOMBSTONE_DAYS * DAY) delete out.tombstones[id]

  // Pins: the newest entry wins, unless a newer tombstone removed it.
  for (const e of [...Object.values(a.pins), ...Object.values(b.pins)]) {
    const old = out.pins[e.pin.id]
    if (!old || beats(e, old)) out.pins[e.pin.id] = e
  }
  for (const [id, e] of Object.entries(out.pins)) {
    const t = out.tombstones[id]
    if (t && newer(t, e)) delete out.pins[id] // deleted after the last change
    else if (t) delete out.tombstones[id] // changed after the deletion: it is back
  }

  // Bookmarks: the same rules as pins (newest change wins, a deletion is a tombstone).
  for (const e of [...Object.values(a.bookmarks), ...Object.values(b.bookmarks)]) {
    const old = out.bookmarks[e.bookmark.id]
    if (!old || beats(e, old)) out.bookmarks[e.bookmark.id] = e
  }
  for (const [id, e] of Object.entries(out.bookmarks)) {
    const t = out.tombstones[id]
    if (t && newer(t, e)) delete out.bookmarks[id]
    else if (t) delete out.tombstones[id]
  }
  if (Object.keys(out.bookmarks).length > MAX_SYNC_BOOKMARKS) {
    for (const [id] of Object.entries(out.bookmarks).sort(([i, x], [j, y]) => x.bookmark.createdAt - y.bookmark.createdAt || byKey(i, j)).slice(0, Object.keys(out.bookmarks).length - MAX_SYNC_BOOKMARKS)) delete out.bookmarks[id]
  }

  // History: by address, the newest visit and the highest count. Anything at or before the last "clear" is gone for good.
  out.historyClearedAt = Math.max(a.historyClearedAt, b.historyClearedAt)
  for (const item of [...Object.values(a.history), ...Object.values(b.history)]) {
    if (item.lastVisit <= out.historyClearedAt) continue
    const removed = out.tombstones[historyTombstoneId(item.url)]
    if (removed && item.lastVisit <= removed.updatedAt) continue // removed from the history after this visit
    const old = out.history[item.url]
    out.history[item.url] = old ? { url: item.url, visits: Math.max(old.visits, item.visits), lastVisit: Math.max(old.lastVisit, item.lastVisit) } : { ...item }
  }
  const kept = Object.values(out.history).sort((x, y) => y.lastVisit - x.lastVisit || byKey(x.url, y.url)).slice(0, MAX_SYNC_HISTORY)
  out.history = Object.fromEntries(kept.map((h) => [h.url, h]))

  // Devices: the newest entry for each, and devices that were not seen for 60 days are forgotten.
  for (const [id, d] of [...Object.entries(a.devices), ...Object.entries(b.devices)]) {
    const old = out.devices[id]
    if (!old || d.updatedAt > old.updatedAt || (d.updatedAt === old.updatedAt && JSON.stringify(d) > JSON.stringify(old))) out.devices[id] = d
  }
  for (const [id, d] of Object.entries(out.devices)) if (now - d.updatedAt > DEVICE_STALE_DAYS * DAY) delete out.devices[id]
  const newestDevices = Object.entries(out.devices).sort(([i, x], [j, y]) => y.updatedAt - x.updatedAt || byKey(i, j)).slice(0, MAX_SYNC_DEVICES)
  out.devices = Object.fromEntries(newestDevices)

  for (const key of PORTABLE_PREF_KEYS) {
    const x = a.prefs[key]
    const y = b.prefs[key]
    const pick = x && y ? (beats(x, y) ? x : y) : x ?? y
    if (pick) out.prefs[key] = pick
  }
  return out
}

// ---- Local changes ----

/** The pins that this device has now, as changes on top of the shared document. */
export interface LocalDocChanges {
  pins: SyncPin[]
  /** Settings changed on this device since the last sync. */
  prefs: Partial<Record<PortablePrefKey, unknown>>
  /** This device's settings that it never synced (a new device): used only where the shared file has no value yet. */
  prefDefaults?: Partial<Record<PortablePrefKey, unknown>>
  deleted: string[]
  /** Left out (undefined) when the person turned that kind of sync off. */
  bookmarks?: SyncBookmark[]
  history?: SyncHistoryItem[]
  /** The app's history was cleared here at this time. */
  historyClearedAt?: number
  /** Pages removed from the history here, and when. */
  historyRemoved?: Array<{ url: string; at: number }>
  /** This device's name and open pages. `null` removes them from the shared file. Left out: not touched. */
  deviceInfo?: SyncDevice | null
}

export function applyLocal(doc: SyncDoc, local: LocalDocChanges, device: string, now: number): SyncDoc {
  const out: SyncDoc = { ...doc, pins: { ...doc.pins }, prefs: { ...doc.prefs }, tombstones: { ...doc.tombstones }, bookmarks: { ...doc.bookmarks }, history: { ...doc.history }, devices: { ...doc.devices } }
  for (const pin of local.pins) {
    const old = out.pins[pin.id]
    if (!old || JSON.stringify(old.pin) !== JSON.stringify(pin)) out.pins[pin.id] = { updatedAt: now, device, pin } // only real changes get a new time
  }
  for (const id of local.deleted) {
    delete out.pins[id]
    out.tombstones[id] = { id, updatedAt: now, device }
  }
  for (const bm of local.bookmarks ?? []) {
    const old = out.bookmarks[bm.id]
    if (!old || JSON.stringify(old.bookmark) !== JSON.stringify(bm)) out.bookmarks[bm.id] = { updatedAt: now, device, bookmark: bm }
  }
  for (const id of local.deleted) delete out.bookmarks[id] // a deleted bookmark has its tombstone from the loop above
  if (typeof local.historyClearedAt === 'number' && local.historyClearedAt > out.historyClearedAt) {
    out.historyClearedAt = local.historyClearedAt
    out.history = Object.fromEntries(Object.entries(out.history).filter(([, h]) => h.lastVisit > local.historyClearedAt!))
  }
  for (const r of local.historyRemoved ?? []) {
    const id = historyTombstoneId(r.url)
    const old = out.tombstones[id]
    if (!old || r.at > old.updatedAt) out.tombstones[id] = { id, updatedAt: r.at, device }
    const h = out.history[r.url]
    if (h && h.lastVisit <= r.at) delete out.history[r.url]
  }
  for (const h of local.history ?? []) {
    if (h.lastVisit <= out.historyClearedAt) continue
    const removed = out.tombstones[historyTombstoneId(h.url)]
    if (removed && h.lastVisit <= removed.updatedAt) continue
    const old = out.history[h.url]
    out.history[h.url] = old ? { url: h.url, visits: Math.max(old.visits, h.visits), lastVisit: Math.max(old.lastVisit, h.lastVisit) } : { ...h }
  }
  if (local.deviceInfo === null) delete out.devices[device]
  else if (local.deviceInfo) {
    const old = out.devices[device]
    if (!old || old.name !== local.deviceInfo.name || JSON.stringify(old.tabs) !== JSON.stringify(local.deviceInfo.tabs)) out.devices[device] = { updatedAt: now, name: local.deviceInfo.name, tabs: local.deviceInfo.tabs }
  }
  for (const key of PORTABLE_PREF_KEYS) {
    if (!(key in local.prefs)) continue
    const old = out.prefs[key]
    if (!old || JSON.stringify(old.value) !== JSON.stringify(local.prefs[key])) out.prefs[key] = { updatedAt: now, device, value: local.prefs[key] }
  }
  for (const key of PORTABLE_PREF_KEYS) {
    if (!local.prefDefaults || !(key in local.prefDefaults) || key in local.prefs || out.prefs[key]) continue
    out.prefs[key] = { updatedAt: now, device, value: local.prefDefaults[key] }
  }
  return out
}
