import { BrowserWindow, app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { loginItemSettings } from '../shared/loginItem'
import { WIN_DEFAULT_APPS_URL } from '../shared/winRegistration'
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
import { copyText } from '../shared/mcp/setup'
import type { ActivityEntry } from '../shared/mcp/protocol'
import { checkPatch } from '../shared/mcp/settingsPolicy'
import { applySettingsChange } from './applySettings'
import { SEARCH_ENGINES, type Settings } from '../shared/settings'
import { detectBrowsers } from './browsers'
import { listDiaProfiles } from './dia'
import { followThemeOnWindows, windowsLook } from './winChrome'
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
  /** Delete the saved copy of the history. */
  clearHistoryCache: () => void
  /** The setting "keep a window ready" changed. */
  refreshWarm: () => void
  updater: { get: () => UpdateState; checkNow: () => void; installNow: () => void }
  /** The agent (MCP) server: start, stop or move it after a setting changed. */
  applyMcp: () => void
  mcp: {
    state: () => 'off' | 'on' | 'in-use' | 'error'
    url: () => string
    agents: () => Array<{ id: string; name: string; createdAt: number }>
    key: (agentId: string) => string
    addAgent: (name: string) => void
    removeAgent: (id: string) => boolean
    rotateAgent: (id: string) => void
    folders: () => Array<{ id: string; name: string; owner: string; allowDelete: boolean; count: number }>
    removeFolder: (id: string) => boolean
    setFolderPermission: (id: string, allowDelete: boolean) => void
    activity: () => ActivityEntry[]
    approvals: () => Array<{ agentId: string; agentName: string; origin: string }>
    removeApproval: (agentId: string, origin: string) => void
    clearActivity: () => void
    dropUndo: (time: number, tool: string) => void
  }
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
      this.applyChange(before, after)
      return this.view()
    })
    ipcMain.handle(SETTINGS_ACTION, async (event, action: SettingsAction) => {
      if (!fromUs(event)) return null
      await this.run(action)
      return this.view()
    })
  }

  /** Run what a saved change needs. Agents use this too, so their changes behave like the person's. */
  applyChange(before: Settings, after: Settings): void {
    applySettingsChange(before, after, {
      applyHotkey: (accelerator) => this.deps.applyHotkey(accelerator),
      setHotkeyOk: (ok) => { this.hotkeyOk = ok },
      refreshWarm: () => this.deps.refreshWarm(),
      refreshHistory: () => this.deps.refreshHistory(),
      applyMcp: () => this.deps.applyMcp(),
      setLoginItem: (open) => app.setLoginItemSettings(loginItemSettings(open, process.platform))
    })
  }

  open(section?: SettingsSection): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show()
      this.win.focus()
      if (section) this.win.webContents.send(SETTINGS_SECTION, section)
      return
    }
    this.win = new BrowserWindow({
      width: 860,
      height: 640,
      minWidth: 640,
      minHeight: 420,
      title: 'Instant Browser Settings',
      // Mac style: the window buttons sit on a glass sidebar.
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 18, y: 18 },
            vibrancy: 'sidebar' as const,
            visualEffectState: 'active' as const,
            backgroundColor: '#00000000'
          }
        : // Windows 11: a Mica window like the system Settings app, with Windows' own caption buttons.
          windowsLook('mica', 40)),
      webPreferences: { preload: preloadPath('settings'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win.setMenuBarVisibility(false)
    followThemeOnWindows(this.win, true, [this.win.webContents])
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
      update: this.deps.updater.get(),
      mcp: { state: this.deps.mcp.state(), url: this.deps.mcp.url(), agents: this.deps.mcp.agents(), folders: this.deps.mcp.folders(), approvals: this.deps.mcp.approvals(), activity: this.deps.mcp.activity().slice(0, 20) }
    }
  }

  private async run(action: SettingsAction): Promise<void> {
    switch (action.type) {
      case 'clear-data': {
        const { response } = await dialog.showMessageBox(this.win!, {
          type: 'warning',
          message: 'Clear browsing data?',
          detail: 'This signs you out of every site in Instant Browser and removes its cache. Your other browsers are not changed.',
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
      case 'remove-permission':
        this.deps.permissions.remove(action.origin, action.permission)
        break
      case 'open-default-browser-settings':
        await shell.openExternal(
          process.platform === 'darwin'
            ? 'x-apple.systempreferences:com.apple.Desktop-Settings.extension'
            : WIN_DEFAULT_APPS_URL
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
      case 'mcp-copy':
        // The key goes from this process to the clipboard; the settings page never sees it.
        if (action.target === 'claude' || action.target === 'codex' || action.target === 'json' || action.target === 'key') {
          const key = this.deps.mcp.key(String(action.agentId))
          if (key) clipboard.writeText(copyText(action.target, this.deps.mcp.url(), key))
        }
        break
      case 'mcp-agent-add':
        try { this.deps.mcp.addAgent(String(action.name ?? '')) } catch (error) {
          await dialog.showMessageBox(this.win!, { type: 'info', message: 'Could not add the agent', detail: error instanceof Error ? error.message : String(error), buttons: ['OK'] })
        }
        break
      case 'mcp-agent-rotate': {
        const agent = this.deps.mcp.agents().find((a) => a.id === action.id)
        if (!agent) break
        const { response } = await dialog.showMessageBox(this.win!, {
          type: 'warning',
          message: `Make a new key for ${agent.name}?`,
          detail: `${agent.name} stops working with its old key. You must set it up again with the new key.`,
          buttons: ['Cancel', 'Make a new key'],
          defaultId: 0,
          cancelId: 0
        })
        if (response === 1) this.deps.mcp.rotateAgent(action.id)
        break
      }
      case 'mcp-agent-remove': {
        const agent = this.deps.mcp.agents().find((a) => a.id === action.id)
        if (!agent) break
        const { response } = await dialog.showMessageBox(this.win!, {
          type: 'warning',
          message: `Remove ${agent.name}?`,
          detail: `${agent.name} can no longer connect. Its folders stay until you remove them.`,
          buttons: ['Cancel', 'Remove'],
          defaultId: 0,
          cancelId: 0
        })
        if (response === 1) this.deps.mcp.removeAgent(action.id)
        break
      }
      case 'mcp-approval-remove':
        if (typeof action.agentId === 'string' && typeof action.origin === 'string') this.deps.mcp.removeApproval(action.agentId, action.origin)
        break
      case 'mcp-clear-activity':
        this.deps.mcp.clearActivity()
        break
      case 'mcp-undo': {
        // Put an agent's setting change back. Only a safe key can be here, and it is checked again.
        const entry = this.deps.mcp.activity().find((e) => e.time === action.time && e.tool === 'set_setting' && e.undo)
        if (!entry?.undo) break
        try {
          const patch = checkPatch(entry.undo.key, entry.undo.value)
          const before = this.deps.settings.get()
          this.applyChange(before, this.deps.settings.update(patch))
          this.deps.mcp.dropUndo(entry.time, entry.tool)
        } catch { /* the old value is no longer allowed: leave it */ }
        break
      }
      case 'mcp-folder-permission':
        this.deps.mcp.setFolderPermission(String(action.folderId), action.allowDelete === true)
        break
      case 'mcp-remove-folder': {
        const folder = this.deps.mcp.folders().find((f) => f.id === action.folderId)
        if (!folder) break
        const { response } = await dialog.showMessageBox(this.win!, {
          type: 'warning',
          message: `Remove the folder "${folder.name}"?`,
          detail: `The folder and its ${folder.count} pages are deleted. Your own pins are not touched.`,
          buttons: ['Cancel', 'Remove'],
          defaultId: 0,
          cancelId: 0
        })
        if (response === 1) this.deps.mcp.removeFolder(action.folderId)
        break
      }
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
