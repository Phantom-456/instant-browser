import { readFileSync } from 'node:fs'
import { writeFileAtomic } from './atomicWrite'
import type { RawVisit } from '../shared/history'
import type { SyncHistoryItem } from '../shared/sync/portable'

interface Entry { url: string; visits: number; lastVisit: number }
const MAX = 500

/** What was opened from Talaria itself (kept on this computer only). */
export class OwnHistory {
  private entries: Entry[] = []
  /** The history was cleared here (sync tells the other computers). */
  onClear: ((time: number) => void) | null = null
  /** One page was removed from the history here (sync tells the other computers). */
  onRemove: ((url: string, time: number) => void) | null = null
  /** A page was opened (sync listens). */
  onRecord: (() => void) | null = null

  constructor(private readonly path: string) {
    try {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (Array.isArray(raw)) {
        this.entries = raw.filter(
          (e): e is Entry => !!e && typeof e.url === 'string' && typeof e.visits === 'number' && typeof e.lastVisit === 'number'
        )
      }
    } catch {
      this.entries = []
    }
  }

  record(url: string, now = Date.now()): void {
    const found = this.entries.find((e) => e.url === url)
    if (found) {
      found.visits += 1
      found.lastVisit = now
    } else {
      this.entries.push({ url, visits: 1, lastVisit: now })
    }
    this.entries.sort((a, b) => b.lastVisit - a.lastVisit)
    this.entries = this.entries.slice(0, MAX)
    this.write()
    this.onRecord?.()
  }

  /** Forget one address (only this app's own list; other browsers are never changed). */
  remove(url: string, now = Date.now()): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.url !== url)
    if (this.entries.length === before) return false
    this.write()
    this.onRemove?.(url, now)
    this.onRecord?.()
    return true
  }

  clear(now = Date.now()): void {
    this.entries = []
    this.write()
    this.onClear?.(now)
  }

  /** For sync: the history as plain items. */
  items(): SyncHistoryItem[] {
    return this.entries.map((e) => ({ url: e.url, visits: e.visits, lastVisit: e.lastVisit }))
  }

  /** From sync: take over what other computers visited. Keeps the highest count and the newest visit. Anything before `clearedAt` is dropped. */
  mergeIn(items: SyncHistoryItem[], clearedAt: number, removed: Array<{ url: string; at: number }> = []): void {
    const removedAt = new Map(removed.map((r) => [r.url, r.at]))
    const gone = (url: string, lastVisit: number) => lastVisit <= clearedAt || lastVisit <= (removedAt.get(url) ?? -Infinity)
    const byUrl = new Map(this.entries.filter((e) => !gone(e.url, e.lastVisit)).map((e) => [e.url, { ...e }]))
    for (const item of items) {
      if (gone(item.url, item.lastVisit)) continue
      const mine = byUrl.get(item.url)
      byUrl.set(item.url, mine ? { url: item.url, visits: Math.max(mine.visits, item.visits), lastVisit: Math.max(mine.lastVisit, item.lastVisit) } : { url: item.url, visits: item.visits, lastVisit: item.lastVisit })
    }
    const merged = [...byUrl.values()].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, MAX)
    if (JSON.stringify(merged) === JSON.stringify(this.entries)) return
    this.entries = merged
    this.write()
  }

  rows(): RawVisit[] {
    return this.entries.map((e) => ({ url: e.url, title: '', visits: e.visits, lastVisit: e.lastVisit, source: 'Talaria' }))
  }

  private write(): void {
    writeFileAtomic(this.path, JSON.stringify(this.entries))
  }
}
