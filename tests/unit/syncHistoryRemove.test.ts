import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SyncManager, type SyncManagerDeps } from '../../src/main/sync/syncManager'
import { SettingsFile } from '../../src/main/settingsFile'
import { OwnHistory } from '../../src/main/ownHistory'
import { MemoryStorage } from '../../src/shared/sync/engine'
import { applyLocal, emptyDoc, mergeDocs } from '../../src/shared/sync/merge'

/** One computer with history sync on: its own history and sync state, and the shared "Drive" file. */
function computer(drive: MemoryStorage, name: string, clock: { t: number }) {
  const dir = mkdtempSync(join(tmpdir(), `sync-history-${name}-`))
  const settings = new SettingsFile(join(dir, 'settings.json'))
  settings.update({ syncHistory: true })
  const history = new OwnHistory(join(dir, 'history.json'))
  const deps = {
    stateFile: join(dir, 'sync.json'),
    settings,
    pins: () => ({ records: () => [], applySync: () => {} }),
    auth: { isConnected: () => true, isAvailable: () => true },
    crypt: Object.assign(drive, { status: async () => 'ready' as const, hasRecovery: () => false }),
    bookmarks: { list: () => [], take: () => {}, drop: () => {} },
    ownHistory: history,
    openPages: () => [],
    defaultDeviceName: name,
    now: () => clock.t
  } as unknown as SyncManagerDeps
  const sync = new SyncManager(deps)
  history.onRemove = (url, time) => sync.noteHistoryRemoved(url, time) // as index.ts does when history sync is on
  return { history, sync, urls: () => history.items().map((h) => h.url).sort() }
}

describe('removing one page from the history, with history sync on (bug hunt 19)', () => {
  it('the page does not come back at the next sync, and the other computer forgets it too', async () => {
    const drive = new MemoryStorage()
    const clock = { t: 1_000 }
    const mac = computer(drive, 'mac', clock)
    const pc = computer(drive, 'pc', clock)
    mac.history.record('https://secret.example/', 1_000)
    mac.history.record('https://news.example/', 1_100)
    await mac.sync.syncNow()
    clock.t = 2_000
    await pc.sync.syncNow()
    expect(pc.urls()).toEqual(['https://news.example/', 'https://secret.example/'])

    clock.t = 3_000
    expect(mac.history.remove('https://secret.example/', 3_000)).toBe(true)
    await mac.sync.syncNow()
    expect(mac.urls()).toEqual(['https://news.example/'])
    clock.t = 4_000
    await pc.sync.syncNow() // the PC still had it, and sends its history as usual
    clock.t = 5_000
    await mac.sync.syncNow()

    expect(mac.urls()).toEqual(['https://news.example/'])
    expect(pc.urls()).toEqual(['https://news.example/'])
  })

  it('a visit after the removal is history again', () => {
    const removed = applyLocal(applyLocal(emptyDoc(), { pins: [], prefs: {}, deleted: [], history: [{ url: 'https://a.example/', visits: 2, lastVisit: 100 }] }, 'mac', 100), { pins: [], prefs: {}, deleted: [], historyRemoved: [{ url: 'https://a.example/', at: 200 }] }, 'mac', 200)
    const old = applyLocal(emptyDoc(), { pins: [], prefs: {}, deleted: [], history: [{ url: 'https://a.example/', visits: 2, lastVisit: 100 }] }, 'pc', 150)
    expect(mergeDocs(removed, old, 300).history).toEqual({})
    expect(mergeDocs(old, removed, 300).history).toEqual({})
    const again = applyLocal(removed, { pins: [], prefs: {}, deleted: [], history: [{ url: 'https://a.example/', visits: 3, lastVisit: 400 }] }, 'pc', 400)
    expect(Object.keys(mergeDocs(again, old, 500).history)).toEqual(['https://a.example/'])
  })
})
