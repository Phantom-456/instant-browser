/** The last downloads of this run, kept in memory only. Never saved to disk. */

export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadEntry {
  url: string
  filename: string
  savePath: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  startedAt: number
}

/** The part of Electron's DownloadItem we use. */
export interface DownloadItemLike {
  getURL(): string
  getFilename(): string
  getSavePath(): string
  getReceivedBytes(): number
  getTotalBytes(): number
  on(event: 'updated', listener: (event: unknown, state: string) => void): unknown
  once(event: 'done', listener: (event: unknown, state: string) => void): unknown
}

const MAX = 200

export class DownloadLog {
  private entries: DownloadEntry[] = []

  /** Start following one download. Call it after the save path is set. */
  track(item: DownloadItemLike, now = Date.now()): void {
    const entry: DownloadEntry = { url: item.getURL(), filename: item.getFilename(), savePath: item.getSavePath(), state: 'progressing', receivedBytes: 0, totalBytes: 0, startedAt: now }
    this.entries.push(entry)
    if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX)
    const refresh = (state: DownloadState) => {
      entry.state = state
      entry.filename = item.getFilename()
      entry.savePath = item.getSavePath()
      entry.receivedBytes = item.getReceivedBytes()
      entry.totalBytes = item.getTotalBytes()
    }
    item.on('updated', (_e, state) => refresh(state === 'interrupted' ? 'interrupted' : 'progressing'))
    item.once('done', (_e, state) => refresh(state === 'completed' || state === 'cancelled' ? state : 'interrupted'))
  }

  /** Newest first. */
  recent(limit = MAX): DownloadEntry[] {
    return this.entries.slice(-limit).reverse().map((e) => ({ ...e }))
  }
}

export const downloadLog = new DownloadLog()
