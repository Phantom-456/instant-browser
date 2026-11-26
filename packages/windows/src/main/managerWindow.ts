import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { MANAGER_ACTION, MANAGER_CHANGED, MANAGER_GET, type ManagerAction, type ManagerAgentFolder, type ManagerView } from '../shared/ipc'
import type { PinManager } from './pins/pinManager'
import { preloadPath, rendererPage } from './searchBar'
import { followThemeOnWindows, windowsLook } from './winChrome'

/** The window that lists every pin (and the open windows), with the actions for each. */
export class ManagerWindow {
  private win: BrowserWindow | null = null

  constructor(
    private readonly pins: () => PinManager | null,
    private readonly extra: {
      /** Open a web page in a small window. */
      openUrl: (url: string) => void
      agentFolders: () => ManagerAgentFolder[]
      agentRemoveItem: (folderId: string, itemId: string) => void
      agentRemoveFolder: (folderId: string) => void
      agentSetPermission: (folderId: string, allowDelete: boolean) => void
    }
  ) {
    const fromUs = (event: IpcMainInvokeEvent) => !!this.win && event.sender === this.win.webContents
    ipcMain.handle(MANAGER_GET, (event) => (fromUs(event) ? this.view() : null))
    ipcMain.handle(MANAGER_ACTION, async (event, action: ManagerAction) => {
      if (!fromUs(event) || !action || typeof action !== 'object') return this.view()
      // Agent folders and opening a page: your own actions in your own window. They need no pin manager.
      if (action.type === 'open-url') { if (typeof action.url === 'string' && /^https?:\/\//i.test(action.url)) this.extra.openUrl(action.url); return this.view() }
      if (action.type === 'agent-remove-item') { if (typeof action.folderId === 'string' && typeof action.itemId === 'string') this.extra.agentRemoveItem(action.folderId, action.itemId); return this.view() }
      if (action.type === 'agent-remove-folder') { if (typeof action.folderId === 'string') this.extra.agentRemoveFolder(action.folderId); return this.view() }
      if (action.type === 'agent-permission') { if (typeof action.folderId === 'string') this.extra.agentSetPermission(action.folderId, action.allowDelete === true); return this.view() }
      const manager = this.pins()
      if (!manager) return this.view()
      // Deleting for good is the one thing that cannot be undone: ask first, saying what goes.
      if (action.type === 'delete') {
        const row = manager.managerView().archive.find((r) => r.id === action.id)
        if (!row) return this.view()
        const { response } = await dialog.showMessageBox(this.win!, {
          type: 'warning',
          message: `Delete "${row.label}" for good?`,
          detail: 'The pin and its saved picture are deleted from this computer. This cannot be undone. (To only take it off the screen, use Remove, which keeps it in the archive.)',
          buttons: ['Keep it', 'Delete for good'],
          defaultId: 0,
          cancelId: 0
        })
        if (response !== 1) return this.view()
      }
      await manager.managerAction(action)
      return this.view()
    })
  }

  private view(): ManagerView {
    const base = this.pins()?.managerView() ?? { pins: [], archive: [], windows: [], platform: process.platform, maxPins: 12 }
    return { ...base, agentFolders: this.extra.agentFolders() }
  }

  /** Tell the page that something changed (a pin was added, offloaded, removed...). */
  refresh(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(MANAGER_CHANGED)
  }

  isOpen(): boolean { return !!this.win && !this.win.isDestroyed() }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show()
      this.win.focus()
      return
    }
    this.win = new BrowserWindow({
      width: 760,
      height: 640,
      minWidth: 560,
      minHeight: 420,
      title: 'Instant Browser Pin Manager',
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 }, vibrancy: 'sidebar' as const, visualEffectState: 'active' as const, backgroundColor: '#00000000' }
        : windowsLook('mica', 40)),
      webPreferences: { preload: preloadPath('manager'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win.setMenuBarVisibility(false)
    followThemeOnWindows(this.win, true, [this.win.webContents])
    this.win.on('closed', () => { this.win = null })
    this.win.webContents.on('will-navigate', (event) => event.preventDefault())
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const page = rendererPage('manager')
    if (page.url) void this.win.loadURL(page.url)
    else if (page.file) void this.win.loadFile(page.file)
  }
}
