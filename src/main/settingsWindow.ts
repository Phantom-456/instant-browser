import { hotkeyShared } from './hotkey'
import { BrowserWindow, Menu, app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
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
import { canSkip, problemReportUrl, releaseNotesUrl, type UpdateState } from '../shared/updateLabel'
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
import { copyText, type McpCopyTarget } from '../shared/mcp/setup'
import type { ActivityEntry } from '../shared/mcp/protocol'
import { checkPatch } from '../shared/mcp/settingsPolicy'
import { applySettingsChange } from './applySettings'

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
  updater: { get: () => UpdateState; checkNow: () => void; installNow: () => void; skip: () => void; unskipAll: () => void }
  /** Can this computer ask for Touch ID? */
  touchIdAvailable: () => boolean
  /** The agent (MCP) server: start, stop or move it after a setting changed. */
  applyMcp: () => void
  mcp: { state: () => 'off' | 'on' | 'in-use' | 'error'; url: () => string; agents: () => Array<{ id: string; name: string; createdAt: number }>; key: (agentId: string) => string; addAgent: (name: string) => void; removeAgent: (id: string) => boolean; rotateAgent: (id: string) => void; folders: () => Array<{ id: string; name: string; owner: string; allowDelete: boolean; count: number }>; removeFolder: (id: string) => boolean; setFolderPermission: (id: string, allowDelete: boolean) => void; approvals: () => Array<{ agentId: string; agentName: string; origin: string }>; removeApproval: (agentId: string, origin: string) => void; activity: () => ActivityEntry[]; clearActivity: () => void; dropUndo: (time: number, tool: string) => void }
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
      refreshBrowsers: () => this.deps.refreshBrowsers(),
      applyMcp: () => this.deps.applyMcp(),
      setLoginItem: (open) => app.setLoginItemSettings({ openAtLogin: open })
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
      hotkeyShared: hotkeyShared(),
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
      touchIdAvailable: this.deps.touchIdAvailable(),
      mcp: { state: this.deps.mcp.state(), url: this.deps.mcp.url(), agents: this.deps.mcp.agents(), folders: this.deps.mcp.folders(), approvals: this.deps.mcp.approvals(), activity: this.deps.mcp.activity(), ...(this.takeCopied() ? { copied: this.lastCopied } : {}) }
    }
  }

  /** Set by a copy from the agent menu; shown on the next view only. */
  private pendingCopied: { agentId: string; label: string } | null = null
  private lastCopied: { agentId: string; label: string } | undefined
  private takeCopied(): boolean { this.lastCopied = this.pendingCopied ?? undefined; this.pendingCopied = null; return !!this.lastCopied }

  private copyFor(agentId: string, target: McpCopyTarget, label: string): void {
    const key = this.deps.mcp.key(agentId)
    if (!key) return
    clipboard.writeText(copyText(target, this.deps.mcp.url(), key))
    this.pendingCopied = { agentId, label: `${label} setup copied` }
  }

  private async rotateAsk(id: string): Promise<void> {
    const agent = this.deps.mcp.agents().find((a) => a.id === id)
    if (!agent) return
    const { response } = await dialog.showMessageBox(this.win!, {
      type: 'warning',
      message: `Make a new key for ${agent.name}?`,
      detail: `${agent.name} stops working with its old key. You must set it up again with the new key.`,
      buttons: ['Cancel', 'Make a new key'],
      defaultId: 0,
      cancelId: 0
    })
    if (response === 1) this.deps.mcp.rotateAgent(id)
  }

  private async removeAsk(id: string): Promise<void> {
    const agent = this.deps.mcp.agents().find((a) => a.id === id)
    if (!agent) return
    const { response } = await dialog.showMessageBox(this.win!, {
      type: 'warning',
      message: `Remove ${agent.name}?`,
      detail: `${agent.name} can no longer connect. Its folders stay until you remove them.`,
      buttons: ['Cancel', 'Remove'],
      defaultId: 0,
      cancelId: 0
    })
    if (response === 1) this.deps.mcp.removeAgent(id)
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
      case 'mcp-copy':
        if (['claude', 'codex', 'antigravity', 'json'].includes(action.target)) {
          const key = this.deps.mcp.key(action.agentId)
          if (key) clipboard.writeText(copyText(action.target, this.deps.mcp.url(), key))
        }
        break
      case 'mcp-agent-add':
        try { this.deps.mcp.addAgent(String(action.name ?? '')) } catch (error) {
          await dialog.showMessageBox(this.win!, { type: 'info', message: 'Could not add the agent', detail: error instanceof Error ? error.message : String(error), buttons: ['OK'] })
        }
        break
      case 'mcp-agent-rotate':
        await this.rotateAsk(action.id)
        break
      case 'mcp-agent-remove':
        await this.removeAsk(action.id)
        break
      case 'mcp-agent-menu': {
        const id = String(action.agentId ?? '')
        if (!this.win || !this.deps.mcp.agents().some((a) => a.id === id)) break
        const x = Number.isFinite(action.x) ? Math.round(action.x) : undefined
        const y = Number.isFinite(action.y) ? Math.round(action.y) : undefined
        let chosen: (() => Promise<void> | void) | null = null
        const pick = (fn: () => Promise<void> | void) => () => { chosen = fn }
        const template = action.menu === 'copy'
          ? [
              { label: 'Claude Code', click: pick(() => this.copyFor(id, 'claude', 'Claude Code')) },
              { label: 'Codex', click: pick(() => this.copyFor(id, 'codex', 'Codex')) },
              { label: 'Antigravity', click: pick(() => this.copyFor(id, 'antigravity', 'Antigravity')) },
              { type: 'separator' as const },
              { label: 'Other agents (JSON)', click: pick(() => this.copyFor(id, 'json', 'JSON')) }
            ]
          : [
              { label: 'New key…', click: pick(() => this.rotateAsk(id)) },
              { type: 'separator' as const },
              { label: 'Remove…', click: pick(() => this.removeAsk(id)) }
            ]
        await new Promise<void>((resolve) => Menu.buildFromTemplate(template).popup({ window: this.win!, x, y, callback: () => resolve() }))
        await (chosen as (() => Promise<void> | void) | null)?.()
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
        this.deps.mcp.setFolderPermission(action.folderId, action.allowDelete === true)
        break
      case 'mcp-remove-folder': {
        const folder = this.deps.mcp.folders().find((f) => f.id === action.folderId)
        if (!folder) break
        const { response } = await dialog.showMessageBox(this.win!, {
          type: 'warning',
          message: `Remove the folder "${folder.name}"?`,
          detail: `It was made by ${folder.owner} and holds ${folder.count} pages. The pages are removed from this folder only. Your own bookmarks are not touched.`,
          buttons: ['Cancel', 'Remove'],
          defaultId: 0,
          cancelId: 0
        })
        if (response === 1) this.deps.mcp.removeFolder(action.folderId)
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
      case 'skip-update':
        this.deps.updater.skip()
        break
      case 'unskip-updates':
        this.deps.updater.unskipAll()
        break
      case 'report-problem':
        await shell.openExternal(problemReportUrl({
          version: app.getVersion(),
          system: process.platform === 'darwin' ? `macOS ${process.getSystemVersion()}` : `${process.platform} ${process.getSystemVersion()}`,
          arch: process.arch
        }))
        break
      case 'open-release-notes': {
        // The notes of the version on offer, or of the running one.
        const state = this.deps.updater.get()
        await shell.openExternal(releaseNotesUrl(canSkip(state) && state.version ? state.version : app.getVersion()))
        break
      }
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
