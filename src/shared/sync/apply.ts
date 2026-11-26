import type { PinRecord } from '../pins/model'
import type { Bookmark } from '../bookmarks'
import { historyTombstoneId, type DeviceEntry, type SyncDoc } from './merge'
import type { SyncBookmark, SyncHistoryItem, SyncPin } from './portable'

/**
 * After a sync, what has to change on THIS computer so it matches the merged document. Pure: it only says what to do.
 *  - add: a pin from another computer that is not here yet (it arrives released, placed by this computer);
 *  - update: a pin that another computer changed (name, title, address, archived). Positions are never touched;
 *  - remove: a pin that was deleted for good on another computer (a tombstone newer than the pin here).
 */
export interface ApplyPlan {
  add: SyncPin[]
  update: SyncPin[]
  remove: string[]
  /** Bookmarks: the same three kinds of change. */
  bookmarks: { add: SyncBookmark[]; update: SyncBookmark[]; remove: string[] }
  /** Every history item of the shared file. The app merges them into its own history (it keeps the highest count and newest visit). */
  history: SyncHistoryItem[]
  /** History older than this was cleared on some computer. */
  historyClearedAt: number
  /** Pages removed from the history (on any computer), and when: visits up to then are dropped here too. */
  historyRemoved: Array<{ url: string; at: number }>
  /** The pages that OTHER computers have open (this computer's own entry is left out). */
  devices: Array<{ id: string } & DeviceEntry>
}

const same = (a: SyncPin, b: PinRecord): boolean =>
  a.url === b.url && a.title === b.title && a.label === b.label && a.archived === b.archived

export function planApply(doc: SyncDoc, local: PinRecord[], deviceId: string, localBookmarks: Bookmark[] = []): ApplyPlan {
  const byId = new Map(local.map((p) => [p.id, p]))
  const plan: ApplyPlan = {
    add: [], update: [], remove: [],
    bookmarks: { add: [], update: [], remove: [] },
    history: Object.values(doc.history),
    historyClearedAt: doc.historyClearedAt,
    historyRemoved: Object.values(doc.tombstones).filter((t) => t.id.startsWith(historyTombstoneId(''))).map((t) => ({ url: t.id.slice(historyTombstoneId('').length), at: t.updatedAt })),
    devices: Object.entries(doc.devices).filter(([id]) => id !== deviceId).map(([id, d]) => ({ id, ...d })).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  for (const entry of Object.values(doc.pins)) {
    const mine = byId.get(entry.pin.id)
    if (!mine) plan.add.push(entry.pin)
    else if (entry.device !== deviceId && !same(entry.pin, mine)) plan.update.push(entry.pin) // our own changes are already here
  }
  for (const id of Object.keys(doc.tombstones)) {
    if (byId.has(id) && !doc.pins[id]) plan.remove.push(id)
  }
  // A bookmark kept on this computer only (syncOff) is never changed or removed by another computer, even when that
  // computer has a bookmark of the same page (same address, same id).
  const bookmarkById = new Map(localBookmarks.map((b) => [b.id, b]))
  for (const entry of Object.values(doc.bookmarks)) {
    const mine = bookmarkById.get(entry.bookmark.id)
    if (!mine) plan.bookmarks.add.push(entry.bookmark)
    else if (!mine.syncOff && entry.device !== deviceId && mine.title !== entry.bookmark.title) plan.bookmarks.update.push(entry.bookmark)
  }
  for (const id of Object.keys(doc.tombstones)) {
    const mine = bookmarkById.get(id)
    if (mine && !mine.syncOff && !doc.bookmarks[id]) plan.bookmarks.remove.push(id)
  }
  return plan
}
