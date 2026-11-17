import { contextBridge, ipcRenderer } from 'electron'
import type { HotkeyEvent, SettingsAction, SettingsView } from '../shared/ipc'
import type { Settings } from '../shared/settings'

// A sandboxed preload cannot load other files, so the channel names are written here.
// tests/unit/preloadChannels.test.ts checks that they match src/shared/ipc.ts.
const SETTINGS_GET = 'settings:get'
const SETTINGS_UPDATE = 'settings:update'
const SETTINGS_ACTION = 'settings:action'
const SETTINGS_HOTKEY_EVENT = 'settings:hotkey-event'
const SETTINGS_SECTION = 'settings:section'

contextBridge.exposeInMainWorld('instantSettings', {
  get: (): Promise<SettingsView> => ipcRenderer.invoke(SETTINGS_GET),
  update: (patch: Partial<Settings>): Promise<SettingsView> => ipcRenderer.invoke(SETTINGS_UPDATE, patch),
  action: (action: SettingsAction): Promise<SettingsView> => ipcRenderer.invoke(SETTINGS_ACTION, action),
  onSection: (callback: (section: string) => void) => {
    ipcRenderer.on(SETTINGS_SECTION, (_event, section: string) => callback(section))
  },
  onHotkeyEvent: (callback: (event: HotkeyEvent) => void) => {
    ipcRenderer.on(SETTINGS_HOTKEY_EVENT, (_event, hotkeyEvent: HotkeyEvent) => callback(hotkeyEvent))
  }
})
