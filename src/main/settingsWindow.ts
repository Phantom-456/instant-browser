import { BrowserWindow, app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { acceleratorFromKey } from '../shared/accelerator'
import {
  SETTINGS_ACTION,
  SETTINGS_GET,
  SETTINGS_HOTKEY_EVENT,
  SETTINGS_SECTION,
  SETTINGS_UPDATE,
  type HotkeyEvent,
  type SettingsAction,
  type SettingsView
} from '../shared/ipc'
import type { SettingsSection } from '../shared/bubbles'
import type { UpdateState } from '../shared/updateLabel'
import type { SyncStatus } from '../shared/sync/status'
import { SEARCH_ENGINES, type Settings } from '../shared/settings'
import { detectBrowsers } from './browsers'
import { listDiaProfiles } from './dia'
import { availableSources } from './historyReader'
import type { OwnHistory } from './ownHistory'
import type { PermissionFile } from './permissionFile'
import { preloadPath, rendererPage } from './searchBar'
import type { SettingsFile } from './settingsFile'
import { describeDefaultBrowser } from '../shared/defaultBrowser'
import { currentWebLinkApp, isDefaultBrowser, isTestMode } from './heldKeys'
import { getWebSession } from './webSession'

export interface SettingsWindowDeps {
  settings: SettingsFile
  permissions: PermissionFile
  /** Register a new hotkey. Returns false when it is taken or not valid. */
  applyHotkey: (accelerator: string) => boolean
  /** Switch the global hotkey off while the user records a new one. */
  pauseHotkey: () => void
  /** What was opened from the search bar. */
  ownHistory: OwnHistory
  /** Rebuild the history in the background after a change. */
  refreshHistory: () => void
  refreshBrowsers: () => void
  browserInfo: () => { bookmarkSources: string[]; tabBrowsers: Array<{ name: string; state: 'ok' | 'not-running' | 'denied' | 'error' }> }
  /** Delete the saved copy of the history. */
  clearHistoryCache: () => void
  /** The setting "keep a window ready" changed. */
  refreshWarm: () => void
  updater: { get: () => UpdateState; checkNow: () => void; installNow: () => void }
  /** Can this computer ask for Touch ID? */
  touchIdAvailable: () => boolean
  /** Google Drive sync. */
  sync: { status: () => SyncStatus; connect: () => Promise<void>; syncNow: () => Promise<void>; disconnect: (deleteRemote: boolean) => Promise<void>; setPassphrase: (p: string) => Promise<void>; unlock: (p: string) => Promise<void>; changePassphrase: (current: string, next: string) => Promise<void>; forgetKey: () => void; makeRecoveryKey: () => Promise<string | null>; unlockWithRecovery: (key: string) => Promise<void> }
}

export class SettingsWindow {
  private win: BrowserWindow | null = null
  private hotkeyOk = true
  private recording = false

  constructor(private readonly deps: SettingsWindowDeps, hotkeyOkAtStart: boolean) {
    this.hotkeyOk = hotkeyOkAtStart
    // Only our own settings page may call these.
    const fromUs = (event: IpcMainInvokeEvent) => !!this.win && event.sender === this.win.webContents

    ipcMain.handle(SETTINGS_GET, (event) => (fromUs(event) ? this.view() : null))
    ipcMain.handle(SETTINGS_UPDATE, (event, patch: Partial<Settings>) => {
      if (!fromUs(event) || !patch || typeof patch !== 'object') return null
      const before = this.deps.settings.get()
      const after = this.deps.settings.update(patch)
      if (after.hotkey !== before.hotkey) this.hotkeyOk = this.deps.applyHotkey(after.hotkey)
      if (after.warmWindow !== before.warmWindow) this.deps.refreshWarm()
      if (after.showHistory !== before.showHistory || after.historyOff.join() !== before.historyOff.join()) this.deps.refreshHistory()
      const sameList = (a: string[], b: string[]) => a.join('\u0000') === b.join('\u0000')
      if (after.otherBookmarks !== before.otherBookmarks || after.keepCopy !== before.keepCopy || after.watchBrowsers !== before.watchBrowsers || after.liveTabs !== before.liveTabs || after.showHistory !== before.showHistory ||
          !sameList(after.bookmarksOff, before.bookmarksOff) || !sameList(after.liveTabsOff, before.liveTabsOff) || !sameList(after.historyOff, before.historyOff)) this.deps.refreshBrowsers()
      if (after.launchAtLogin !== before.launchAtLogin) app.setLoginItemSettings({ openAtLogin: after.launchAtLogin })
      return this.view()
    })
    ipcMain.handle(SETTINGS_ACTION, async (event, action: SettingsAction) => {
      if (!fromUs(event)) return null
      await this.run(action)
      return this.view()
    })
  }

  open(section?: SettingsSection): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show()
      this.win.moveTop()
      this.win.focus()
      if (section) this.win.webContents.send(SETTINGS_SECTION, section)
      return
    }
    this.win = new BrowserWindow({
      width: 860,
      height: 640,
      minWidth: 640,
      minHeight: 420,
      title: 'Talaria Settings',
      // Mac style: the window buttons sit on a glass sidebar.
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 18, y: 18 },
            vibrancy: 'sidebar' as const,
            visualEffectState: 'active' as const,
            backgroundColor: '#00000000'
          }
        : {}),
      webPreferences: { preload: preloadPath('settings'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win.setMenuBarVisibility(false)
    // Pins and mini windows float above other windows; this window must float with them (and not hide behind them).
    this.win.setAlwaysOnTop(true, 'floating')
    this.win.on('closed', () => {
      this.win = null
      this.stopRecording() // never leave the hotkey switched off
    })
    // While recording, every key goes to the recorder. This also stops menu shortcuts such as Cmd+Q.
    this.win.webContents.on('before-input-event', (event, input) => {
      if (!this.recording || input.type !== 'keyDown') return
      event.preventDefault()
      this.onRecordedKey(input)
    })
    // The settings page never leaves our own files.
    this.win.webContents.on('will-navigate', (event) => event.preventDefault())
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const page = rendererPage('settings')
    const hash = section ? encodeURIComponent(section) : ''
    if (page.url) void this.win.loadURL(page.url + (hash ? `#${hash}` : ''))
    else if (page.file) void this.win.loadFile(page.file, hash ? { hash } : undefined)
  }

  private async view(): Promise<SettingsView> {
    const live = await listDiaProfiles()
    if (live && live.join('\n') !== this.deps.settings.get().diaProfiles.join('\n')) this.deps.settings.update({ diaProfiles: live })
    return {
      settings: this.deps.settings.get(),
      hotkeyOk: this.hotkeyOk,
      engines: SEARCH_ENGINES,
      browsers: await detectBrowsers(),
      permissions: this.deps.permissions.list(),
      about: { app: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome },
      platform: process.platform,
      isDefaultBrowser: isDefaultBrowser(),
      defaultBrowser: describeDefaultBrowser({
        platform: process.platform,
        isDefault: isDefaultBrowser(),
        currentApp: currentWebLinkApp(),
        packaged: app.isPackaged || (isTestMode() && process.env.INSTANT_TEST_PACKAGED === '1'),
        inApplicationsFolder: process.platform !== 'darwin' || app.getPath('exe').startsWith('/Applications/')
      }),
      diaProfiles: live ?? this.deps.settings.get().diaProfiles,
      diaProfilesLive: live !== null,
      historySources: availableSources(),
      bookmarkSources: this.deps.browserInfo().bookmarkSources,
      tabBrowsers: this.deps.browserInfo().tabBrowsers,
      tabsAvailable: process.platform === 'darwin',
      update: this.deps.updater.get(),
      sync: this.deps.sync.status(),
      touchIdAvailable: this.deps.touchIdAvailable()
    }
  }

  private async run(action: SettingsAction): Promise<void> {
    switch (action.type) {
      case 'clear-data': {
        const { response } = await dialog.showMessageBox(this.win!, {
          type: 'warning',
          message: 'Clear browsing data?',
          detail: 'This signs you out of every site in Talaria and removes its cache. Your other browsers are not changed.',
          buttons: ['Cancel', 'Clear data'],
          defaultId: 0,
          cancelId: 0
        })
        if (response === 1) {
          await getWebSession().clearStorageData()
          await getWebSession().clearCache()
        }
        break
      }
      case 'sync-connect':
        void this.deps.sync.connect() // it waits for the person in the browser: the page asks for the status again
        break
      case 'sync-set-passphrase':
        await this.deps.sync.setPassphrase(action.passphrase)
        break
      case 'sync-change-passphrase':
        await this.deps.sync.changePassphrase(action.current, action.passphrase)
        break
      case 'sync-forget-key': {
        const { response } = await dialog.showMessageBox(this.win!, {
          type: 'warning',
          message: 'Remove the key from this computer?',
          detail: 'Sync stops on this computer until you enter the passphrase again. Your data in Google Drive and on your other computers is not changed.',
          buttons: ['Remove the key', 'Cancel'],
          defaultId: 1,
          cancelId: 1
        })
        if (response === 0) this.deps.sync.forgetKey()
        break
      }
      case 'sync-make-recovery': {
        const key = await this.deps.sync.makeRecoveryKey()
        if (key) {
          const { response } = await dialog.showMessageBox(this.win!, {
            type: 'info',
            message: 'Your recovery key',
            detail: `${key}\n\nWrite it down or save it in your password manager now. It is shown only once and Talaria does not keep it. If you lose your passphrase, this key opens your synced data. Anyone who has it can open your data, so keep it private. If you change your passphrase, make a new recovery key.`,
            buttons: ['I saved it', 'Copy to clipboard'],
            defaultId: 0
          })
          if (response === 1) clipboard.writeText(key)
        }
        break
      }
      case 'sync-unlock-recovery':
        await this.deps.sync.unlockWithRecovery(action.key)
        break
      case 'sync-unlock':
        await this.deps.sync.unlock(action.passphrase)
        break
      case 'sync-now':
        await this.deps.sync.syncNow()
        break
      case 'sync-disconnect':
        await this.deps.sync.disconnect(false)
        break
      case 'sync-disconnect-delete': {
        const { response } = await dialog.showMessageBox(this.win!, {
          type: 'warning',
          message: 'Disconnect and delete the synced data?',
          detail: 'The synced file is deleted from your Google Drive and this computer is disconnected. Your pins and settings on this computer stay. Other computers keep their own copies and will no longer sync. This cannot be undone.',
          buttons: ['Cancel', 'Disconnect and delete'],
          defaultId: 0,
          cancelId: 0
        })
        if (response === 1) await this.deps.sync.disconnect(true)
        break
      }
      case 'remove-permission':
        this.deps.permissions.remove(action.origin, action.permission)
        break
      case 'open-default-browser-settings':
        await shell.openExternal(
          process.platform === 'darwin'
            ? 'x-apple.systempreferences:com.apple.Desktop-Settings.extension'
            : 'ms-settings:defaultapps'
        )
        break
      case 'hotkey-record-start':
        this.recording = true
        this.deps.pauseHotkey()
        break
      case 'hotkey-record-cancel':
        this.stopRecording()
        break
      case 'make-default-browser':
        // The user clicked the button. macOS then asks the user to confirm; nothing changes until they do.
        if (isTestMode()) console.log('[instant] make default requested')
        else if (app.isPackaged && process.platform === 'darwin') {
          app.setAsDefaultProtocolClient('http')
          app.setAsDefaultProtocolClient('https')
        }
        break
      case 'check-updates':
        this.deps.updater.checkNow()
        break
      case 'install-update':
        this.deps.updater.installNow()
        break
      case 'clear-own-history':
        this.deps.ownHistory.clear()
        this.deps.clearHistoryCache()
        this.deps.refreshHistory()
        break
      case 'choose-download-folder': {
        const { canceled, filePaths } = await dialog.showOpenDialog(this.win!, { properties: ['openDirectory', 'createDirectory'] })
        if (!canceled && filePaths[0]) this.deps.settings.update({ downloadFolder: filePaths[0] })
        break
      }
    }
  }

  private sendHotkeyEvent(event: HotkeyEvent): void {
    this.win?.webContents.send(SETTINGS_HOTKEY_EVENT, event)
  }

  /** Stop recording and put the saved hotkey back. */
  private stopRecording(): void {
    if (!this.recording) return
    this.recording = false
    this.hotkeyOk = this.deps.applyHotkey(this.deps.settings.get().hotkey)
  }

  private onRecordedKey(input: Electron.Input): void {
    const result = acceleratorFromKey(
      { code: input.code, key: input.key, control: input.control, alt: input.alt, shift: input.shift, meta: input.meta },
      process.platform
    )
    if (result.status === 'pending' || result.status === 'invalid') {
      this.sendHotkeyEvent({ status: result.status, text: result.text })
    } else if (result.status === 'cancel') {
      this.stopRecording()
      this.sendHotkeyEvent({ status: 'cancel', text: '' })
    } else {
      this.recording = false
      const error = this.applyNewHotkey(result.accelerator)
      this.sendHotkeyEvent(error ? { status: 'invalid', text: error } : { status: 'done', text: '' })
    }
  }

  /** Try the new hotkey. When it does not work, the old one is kept. Returns a message on failure. */
  private applyNewHotkey(accelerator: string): string | null {
    const before = this.deps.settings.get().hotkey
    if (this.deps.applyHotkey(accelerator)) {
      this.deps.settings.update({ hotkey: accelerator })
      this.hotkeyOk = true
      return null
    }
    this.hotkeyOk = this.deps.applyHotkey(before)
    return 'This key is used by another app or by the system. Your old hotkey is kept. Click Change to try another key.'
  }
}
