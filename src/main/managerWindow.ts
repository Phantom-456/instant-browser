import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { MANAGER_ACTION, MANAGER_CHANGED, MANAGER_GET, type ManagerAction, type ManagerView } from '../shared/ipc'
import type { PinManager } from './pins/pinManager'
import { preloadPath, rendererPage } from './searchBar'

/** The window that lists every pin (and the open windows), with the actions for each. */
export class ManagerWindow {
  private win: BrowserWindow | null = null

  constructor(private readonly pins: () => PinManager | null) {
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
      await manager.managerAction(action)
      return this.view()
    })
  }

  private view(): ManagerView {
    return this.pins()?.managerView() ?? { pins: [], archive: [], windows: [], platform: process.platform, maxPins: 12 }
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
        : {}),
      webPreferences: { preload: preloadPath('manager'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win.setMenuBarVisibility(false)
    this.win.on('closed', () => { this.win = null })
    this.win.webContents.on('will-navigate', (event) => event.preventDefault())
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const page = rendererPage('manager')
    if (page.url) void this.win.loadURL(page.url)
    else if (page.file) void this.win.loadFile(page.file)
  }
}
