import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RawVisit } from '../shared/history'

interface Entry { url: string; visits: number; lastVisit: number }
const MAX = 500

/** What was opened from Instant Browser itself (kept on this computer only). */
export class OwnHistory {
  private entries: Entry[] = []

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
  }

  clear(): void {
    this.entries = []
    this.write()
  }

  rows(): RawVisit[] {
    return this.entries.map((e) => ({ url: e.url, title: '', visits: e.visits, lastVisit: e.lastVisit, source: 'Instant Browser' }))
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.entries))
  }
}
