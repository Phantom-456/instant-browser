import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { MANAGER_ACTION, MANAGER_CHANGED, MANAGER_GET, type ManagerAction, type ManagerBookmark, type ManagerDevice, type ManagerHistoryRow, type ManagerLiveTab, type ManagerMarkFolder, type ManagerView } from '../shared/ipc'
import type { PinManager } from './pins/pinManager'
import { preloadPath, rendererPage } from './searchBar'

/** The window that lists every pin (and the open windows), with the actions for each. */
export class ManagerWindow {
  private win: BrowserWindow | null = null

  constructor(
    private readonly pins: () => PinManager | null,
    private readonly extra: {
      bookmarks: () => ManagerBookmark[]
      devices: () => ManagerDevice[]
      openUrl: (url: string) => void
      removeBookmark: (id: string) => void
      setBookmarkLocal: (id: string, off: boolean) => void
      history: () => ManagerHistoryRow[]
      browserMarks: () => { count: number; tree: ManagerMarkFolder }
      tabs: () => ManagerLiveTab[]
      deleteHistory: (url: string) => void
      editBookmark: (id: string, title: string, url: string) => 'ok' | 'invalid' | 'exists'
    }
  ) {
    const fromUs = (event: IpcMainInvokeEvent) => !!this.win && event.sender === this.win.webContents
    ipcMain.handle(MANAGER_GET, (event) => (fromUs(event) ? this.view() : null))
    ipcMain.handle(MANAGER_ACTION, async (event, action: ManagerAction) => {
      if (!fromUs(event) || !action || typeof action !== 'object') return this.view()
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
      if (action.type === 'open-url') { if (typeof action.url === 'string' && /^https?:\/\//i.test(action.url)) this.extra.openUrl(action.url); return this.view() }
      if (action.type === 'remove-bookmark') { if (typeof action.id === 'string') this.extra.removeBookmark(action.id); return this.view() }
      if (action.type === 'history-delete') { if (typeof action.url === 'string') this.extra.deleteHistory(action.url); return this.view() }
      if (action.type === 'bookmark-edit') {
        if (typeof action.id === 'string' && typeof action.title === 'string' && typeof action.url === 'string') {
          const result = this.extra.editBookmark(action.id, action.title, action.url)
          if (result !== 'ok') void dialog.showMessageBox(this.win!, { type: 'info', message: result === 'exists' ? 'That page is already bookmarked.' : 'That is not a web address (http or https).', buttons: ['OK'] })
        }
        return this.view()
      }
      if (action.type === 'bookmark-local') { if (typeof action.id === 'string') this.extra.setBookmarkLocal(action.id, action.off === true); return this.view() }
      await manager.managerAction(action)
      return this.view()
    })
  }

  private view(): ManagerView {
    const base = this.pins()?.managerView() ?? { pins: [], archive: [], windows: [], platform: process.platform, maxPins: 12 }
    return { ...base, bookmarks: this.extra.bookmarks(), history: this.extra.history(), devices: this.extra.devices(), browserMarks: this.extra.browserMarks(), tabs: this.extra.tabs() }
  }

  /** Tell the page that something changed (a pin was added, offloaded, removed...). */
  refresh(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(MANAGER_CHANGED)
  }

  isOpen(): boolean { return !!this.win && !this.win.isDestroyed() }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show()
      this.win.moveTop()
      this.win.focus()
      return
    }
    this.win = new BrowserWindow({
      width: 760,
      height: 640,
      minWidth: 560,
      minHeight: 420,
      title: 'Talaria Manage',
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 }, vibrancy: 'sidebar' as const, visualEffectState: 'active' as const, backgroundColor: '#00000000' }
        : {}),
      webPreferences: { preload: preloadPath('manager'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win.setMenuBarVisibility(false)
    // Pins and mini windows float above other windows; this window must float with them (and not hide behind them).
    this.win.setAlwaysOnTop(true, 'floating')
    this.win.on('closed', () => { this.win = null })
    this.win.webContents.on('will-navigate', (event) => event.preventDefault())
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const page = rendererPage('manager')
    if (page.url) void this.win.loadURL(page.url)
    else if (page.file) void this.win.loadFile(page.file)
  }
}
