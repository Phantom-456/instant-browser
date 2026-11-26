import { EventEmitter } from 'node:events'
import { beforeEach, expect, test, vi } from 'vitest'

// The updater talks to Electron and electron-updater; both are replaced here so its skip logic runs in Node.
const fake = vi.hoisted(() => ({ updater: null as unknown as EventEmitter & Record<string, unknown> }))
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.3.0' },
  Notification: class { show(): void {} }
}))
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events')
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    logger: undefined as unknown,
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn()
  })
  fake.updater = updater as unknown as EventEmitter & Record<string, unknown>
  return { autoUpdater: updater }
})

import { Updater } from '../../src/main/updater'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings'
import type { UpdateState } from '../../src/shared/updateLabel'

let settings: Settings
let states: UpdateState[]
let updater: Updater

beforeEach(() => {
  fake.updater.removeAllListeners()
  ;(fake.updater.downloadUpdate as ReturnType<typeof vi.fn>).mockClear()
  ;(fake.updater.checkForUpdates as ReturnType<typeof vi.fn>).mockClear()
  settings = { ...DEFAULT_SETTINGS, skippedVersions: [] }
  states = []
  updater = new Updater(() => settings, (s) => states.push(s), (patch) => { settings = { ...settings, ...patch } })
  updater.start()
  updater.stop()
})

test('does not download before it knows the version is not skipped', () => {
  expect(fake.updater.autoDownload).toBe(false)
  expect(fake.updater.allowPrerelease).toBe(false)
})

test('a new version is downloaded', () => {
  fake.updater.emit('update-available', { version: '0.3.1' })
  expect(fake.updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(updater.get()).toMatchObject({ status: 'downloading', version: '0.3.1' })
})

test('a skipped version is never downloaded', () => {
  settings.skippedVersions = ['0.3.1']
  fake.updater.emit('update-available', { version: '0.3.1' })
  expect(fake.updater.downloadUpdate).not.toHaveBeenCalled()
  expect(updater.get()).toMatchObject({ status: 'skipped', version: '0.3.1' })
})

test('skipping a downloaded version remembers it and does not install it on quit', () => {
  fake.updater.emit('update-available', { version: '0.3.1' })
  fake.updater.emit('update-downloaded', { version: '0.3.1' })
  expect(updater.get().status).toBe('ready')
  updater.skip()
  expect(settings.skippedVersions).toEqual(['0.3.1'])
  expect(fake.updater.autoInstallOnAppQuit).toBe(false)
  expect(updater.get()).toMatchObject({ status: 'skipped', version: '0.3.1' })
})

test('a newer version after a skip is offered and installs on quit again', () => {
  settings.skippedVersions = ['0.3.1']
  fake.updater.autoInstallOnAppQuit = false
  fake.updater.emit('update-available', { version: '0.3.2' })
  fake.updater.emit('update-downloaded', { version: '0.3.2' })
  expect(updater.get()).toMatchObject({ status: 'ready', version: '0.3.2' })
  expect(fake.updater.autoInstallOnAppQuit).toBe(true)
})

test('Allow again forgets the skipped versions and looks again', () => {
  settings.skippedVersions = ['0.3.1']
  fake.updater.emit('update-available', { version: '0.3.1' })
  updater.unskipAll()
  expect(settings.skippedVersions).toEqual([])
  expect(fake.updater.checkForUpdates).toHaveBeenCalledTimes(1)
})

test('skip does nothing when no update is on offer', () => {
  updater.skip()
  expect(settings.skippedVersions).toEqual([])
})
