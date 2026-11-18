import { applyLocal, mergeDocs, parseDoc, type LocalDocChanges, type SyncDoc } from './merge'

/** Where the shared document lives (the Drive app folder in production, memory in tests). `etag` changes on every write. */
export interface SyncStorage {
  read(): Promise<{ doc: unknown; etag: string } | null>
  /** Write only if nobody changed the document since `etag` (null: only if it does not exist). Returns false on a conflict. */
  write(doc: SyncDoc, etag: string | null): Promise<boolean>
}

export type LocalChanges = LocalDocChanges

export type SyncResult =
  | { ok: true; doc: SyncDoc; attempts: number }
  | { ok: false; reason: 'offline' | 'conflict-limit'; error?: string }

/**
 * One round: read the shared document, merge this device's changes into it, write it back if nobody else wrote in
 * between, and try again if somebody did (at most `maxAttempts` times). Offline is not an error: the changes stay
 * with the caller, who keeps them and calls again later. The returned document is what this device should now show.
 */
export async function syncOnce(storage: SyncStorage, local: LocalChanges, device: string, now: number, maxAttempts = 5): Promise<SyncResult> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let remote: { doc: unknown; etag: string } | null
    try {
      remote = await storage.read()
    } catch (error) {
      return { ok: false, reason: 'offline', error: String(error) }
    }
    const base = parseDoc(remote?.doc ?? null)
    const merged = mergeDocs(base, applyLocal(base, local, device, now), now)
    // Nothing to tell Drive: do not write (it would only make every computer write all the time).
    if (remote && stable(merged) === stable(base)) return { ok: true, doc: merged, attempts: attempt }
    try {
      if (await storage.write(merged, remote?.etag ?? null)) return { ok: true, doc: merged, attempts: attempt }
    } catch (error) {
      return { ok: false, reason: 'offline', error: String(error) }
    }
    // Another device wrote first: read again and merge on top of that.
  }
  return { ok: false, reason: 'conflict-limit' }
}

/** The document as text with the keys in a fixed order, to compare two documents. */
function stable(doc: unknown): string {
  return JSON.stringify(doc, (_key, value) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) : value))
}

/** A memory store for tests. */
export class MemoryStorage implements SyncStorage {
  private doc: unknown = null
  private version = 0
  online = true
  /** A function that runs once before the next write, to act like another device writing at that moment. */
  beforeWrite: (() => void) | null = null

  /** Tests: the document now (as stored). */
  peek(): unknown { return this.doc }
  /** Tests: another computer writes right now, in one step. */
  injectWrite(doc: unknown): void { this.doc = JSON.parse(JSON.stringify(doc)); this.version++ }

  async read() {
    if (!this.online) throw new Error('offline')
    return this.doc === null ? null : { doc: JSON.parse(JSON.stringify(this.doc)) as unknown, etag: String(this.version) }
  }

  async write(doc: SyncDoc, etag: string | null) {
    if (!this.online) throw new Error('offline')
    const hook = this.beforeWrite
    this.beforeWrite = null
    hook?.()
    if ((etag ?? null) !== (this.doc === null ? null : String(this.version))) return false
    this.doc = JSON.parse(JSON.stringify(doc))
    this.version++
    return true
  }
}
