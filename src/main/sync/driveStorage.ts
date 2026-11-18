import type { OAuthEndpoints } from '../../shared/sync/oauth'
import type { SyncStorage } from '../../shared/sync/engine'
import type { SyncDoc } from '../../shared/sync/merge'

export const SYNC_FILE_NAME = 'quickpeek-sync.json'

/**
 * The shared document as one small file in the hidden app data folder of the person's Google Drive. With the
 * `drive.appdata` permission this program can see only this folder, never the rest of Drive.
 * Drive has no "write only if unchanged" for this, so before a write the file's version number is read again: if it is not the
 * one we merged with, somebody else wrote in between and the caller merges again.
 */
export class DriveStorage implements SyncStorage {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly endpoints: OAuthEndpoints,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchFn(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await this.token()}` } })
    if (!response.ok && response.status !== 404) throw new Error(`Drive answered ${response.status}`)
    return response
  }

  private async find(): Promise<{ id: string; version: string } | null> {
    const query = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${SYNC_FILE_NAME}' and trashed = false`, fields: 'files(id,version)', pageSize: '10' })
    const response = await this.call(`${this.endpoints.drive}/files?${query}`)
    const json = (await response.json()) as { files?: Array<{ id: string; version?: string }> }
    const file = json.files?.[0]
    return file ? { id: file.id, version: String(file.version ?? '0') } : null
  }

  async read(): Promise<{ doc: unknown; etag: string } | null> {
    const file = await this.find()
    if (!file) return null
    const response = await this.call(`${this.endpoints.drive}/files/${encodeURIComponent(file.id)}?alt=media`)
    if (response.status === 404) return null
    return { doc: await response.json().catch(() => null), etag: file.version }
  }

  async write(doc: SyncDoc, etag: string | null): Promise<boolean> {
    const file = await this.find()
    const body = JSON.stringify(doc)
    if (etag === null) {
      if (file) return false // somebody created it while we were merging
      const boundary = `qp${Math.random().toString(36).slice(2)}`
      const metadata = JSON.stringify({ name: SYNC_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' })
      await this.call(`${this.endpoints.upload}/files?uploadType=multipart`, {
        method: 'POST',
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        body: `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${body}\r\n--${boundary}--`
      })
      return true
    }
    if (!file || file.version !== etag) return false // changed since we read it
    await this.call(`${this.endpoints.upload}/files/${encodeURIComponent(file.id)}?uploadType=media`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body })
    return true
  }

  /** Delete the synced file for good (disconnect and clear). */
  async remove(): Promise<void> {
    const file = await this.find()
    if (file) await this.call(`${this.endpoints.drive}/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
  }
}
