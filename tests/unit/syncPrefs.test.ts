import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SyncManager, type SyncManagerDeps } from '../../src/main/sync/syncManager'
import { SettingsFile } from '../../src/main/settingsFile'
import { MemoryStorage } from '../../src/shared/sync/engine'

/** One computer: its own settings file and sync state, the shared "Drive" file, and nothing else (no pins, bookmarks or history). */
function computer(drive: MemoryStorage, name: string, clock: { t: number }) {
  const dir = mkdtempSync(join(tmpdir(), `sync-prefs-${name}-`))
  const settings = new SettingsFile(join(dir, 'settings.json'))
  const crypt = Object.assign(drive, { status: async () => 'ready' as const, hasRecovery: () => false })
  const deps = {
    stateFile: join(dir, 'sync.json'),
    settings,
    pins: () => ({ records: () => [], applySync: () => {} }),
    auth: { isConnected: () => true, isAvailable: () => true },
    crypt,
    bookmarks: { list: () => [], take: () => {}, drop: () => {} },
    ownHistory: { items: () => [], mergeIn: () => {} },
    openPages: () => [],
    defaultDeviceName: name,
    now: () => clock.t
  } as unknown as SyncManagerDeps
  return { settings, sync: new SyncManager(deps) }
}

describe('settings that sync (bug hunt 18)', () => {
  it('a setting changed on one computer is not undone by another computer that only syncs', async () => {
    const drive = new MemoryStorage()
    const clock = { t: 1_000 }
    const mac = computer(drive, 'mac', clock)
    const pc = computer(drive, 'pc', clock)
    await mac.sync.syncNow()
    clock.t += 1_000
    await pc.sync.syncNow()

    clock.t += 1_000
    mac.settings.update({ pinSize: 34 })
    await mac.sync.syncNow()
    clock.t += 1_000
    await pc.sync.syncNow() // the PC did not touch the setting: it takes it over
    clock.t += 1_000
    await mac.sync.syncNow()

    expect(pc.settings.get().pinSize).toBe(34)
    expect(mac.settings.get().pinSize).toBe(34)
  })

  it('a new computer joining takes over the settings already in the shared file, instead of overwriting them with its defaults', async () => {
    const drive = new MemoryStorage()
    const clock = { t: 1_000 }
    const mac = computer(drive, 'mac', clock)
    mac.settings.update({ pinSize: 34, showSuggestions: false })
    await mac.sync.syncNow()

    clock.t += 1_000
    const pc = computer(drive, 'pc', clock)
    await pc.sync.syncNow()
    clock.t += 1_000
    await mac.sync.syncNow()

    expect([pc.settings.get().pinSize, pc.settings.get().showSuggestions]).toEqual([34, false])
    expect([mac.settings.get().pinSize, mac.settings.get().showSuggestions]).toEqual([34, false])
  })

  it('a setting changed on both computers: the later change wins on both', async () => {
    const drive = new MemoryStorage()
    const clock = { t: 1_000 }
    const mac = computer(drive, 'mac', clock)
    const pc = computer(drive, 'pc', clock)
    await mac.sync.syncNow()
    await pc.sync.syncNow()
    clock.t += 1_000
    mac.settings.update({ pinSize: 22 })
    await mac.sync.syncNow()
    clock.t += 1_000
    pc.settings.update({ pinSize: 34 })
    await pc.sync.syncNow()
    clock.t += 1_000
    await mac.sync.syncNow()
    expect([mac.settings.get().pinSize, pc.settings.get().pinSize]).toEqual([34, 34])
  })
})
