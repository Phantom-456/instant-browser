import { BrowserWindow, ipcMain, screen } from 'electron'
import { BUBBLE_ACTION, BUBBLE_HOVER, type BubbleAction, type BubbleHover } from '../shared/ipc'
import { SETTINGS_SECTIONS, type SettingsSection } from '../shared/bubbles'
import { preloadPath, rendererPage } from './searchBar'

const SIZE = 52 // the round button is 44; the rest is room for its shadow
const GAP = 8
const FLYOUT = { width: 200, height: 52 + 8 + SETTINGS_SECTIONS.length * 30 + 16 }

/**
 * Two round bubbles to the right of the search bar: Settings (a menu opens on hover) and the Pin Manager.
 * They are small windows that cannot take focus, so using them does not close the search bar. Keyboard: Cmd+, and
 * Cmd+Shift+P in the search field do the same.
 */
export class SearchBubbles {
  private readonly settings: BrowserWindow
  private readonly sync: BrowserWindow
  private readonly manager: BrowserWindow
  private bar: BrowserWindow
  private flyoutOpen = false
  private quitting = false

  constructor(
    bar: BrowserWindow,
    private readonly handlers: { openSettings: (section: SettingsSection) => void; openManager: () => void; closeBar: () => void; syncNow: () => void }
  ) {
    this.bar = bar
    this.settings = this.make('settings')
    this.sync = this.make('sync')
    this.manager = this.make('manager')
    this.attachBar(bar)

    ipcMain.on(BUBBLE_ACTION, (event, action: BubbleAction) => {
      if (this.gone()) return
      if (event.sender !== this.settings.webContents && event.sender !== this.manager.webContents && event.sender !== this.sync.webContents) return
      if (!action || typeof action !== 'object') return
      if (action.kind === 'manager') { handlers.closeBar(); handlers.openManager(); return }
      if (action.kind === 'sync') { handlers.syncNow(); return } // the bar stays open: you can watch it work
      const known = SETTINGS_SECTIONS.find((s) => s === action.section) ?? 'General'
      handlers.closeBar()
      handlers.openSettings(known)
    })
    ipcMain.on(BUBBLE_HOVER, (event, hover: BubbleHover) => {
      if (this.gone()) return
      if (event.sender !== this.settings.webContents || !hover || hover.kind !== 'settings') return
      this.flyoutOpen = hover.on === true
      this.place()
    })
  }

  /** The bar opened: show the bubbles beside it. Safe to call more than once. */
  showWithBar(): void {
    if (this.gone() || this.bar.isDestroyed()) return
    this.reviveDead()
    this.place()
    this.settings.showInactive()
    this.sync.showInactive()
    this.manager.showInactive()
  }

  attachBar(bar: BrowserWindow): void {
    this.bar = bar
    bar.on('show', () => this.showWithBar())
    bar.on('hide', () => {
      this.flyoutOpen = false
      if (!this.settings.isDestroyed()) this.settings.hide()
      if (!this.sync.isDestroyed()) this.sync.hide()
      if (!this.manager.isDestroyed()) this.manager.hide()
    })
    bar.on('resize', () => {
      if (!this.bar.isDestroyed()) this.place()
    })
    bar.on('closed', () => {
      if (!this.quitting) return
      if (!this.settings.isDestroyed()) this.settings.destroy()
      if (!this.sync.isDestroyed()) this.sync.destroy()
      if (!this.manager.isDestroyed()) this.manager.destroy()
    })
  }

  private gone(): boolean {
    return this.settings.isDestroyed() || this.sync.isDestroyed() || this.manager.isDestroyed()
  }

  prepareQuit(): void {
    this.quitting = true
  }

  private make(kind: 'settings' | 'sync' | 'manager'): BrowserWindow {
    const win = new BrowserWindow({
      width: SIZE, height: SIZE, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
      focusable: false, // using a bubble must not take the keyboard from the search field, or the bar would close
      skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000',
      webPreferences: { preload: preloadPath('bubble'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault()
        win.hide()
      }
    })
    // macOS can end a page process (sleep, low memory). The window stays "visible" but is empty and see-through,
    // so the bubble is gone until the app restarts. Load the page again.
    win.webContents.on('render-process-gone', () => {
      if (!this.quitting && !win.isDestroyed()) this.load(win, kind)
    })
    this.load(win, kind)
    return win
  }

  private load(win: BrowserWindow, kind: 'settings' | 'sync' | 'manager'): void {
    const page = rendererPage('bubble')
    if (page.url) void win.loadURL(`${page.url}#${kind}`)
    else if (page.file) void win.loadFile(page.file, { hash: kind })
  }

  /** A second guard: if a page died without the event, load it again when the bar opens. */
  private reviveDead(): void {
    const kinds = [[this.settings, 'settings'], [this.sync, 'sync'], [this.manager, 'manager']] as const
    for (const [win, kind] of kinds) if (!win.isDestroyed() && win.webContents.isCrashed()) this.load(win, kind)
  }

  /** Put the bubbles to the right of the bar (to the left if there is no room), level with the text field. */
  place(): void {
    if (this.bar.isDestroyed() || this.gone()) return
    const b = this.bar.getBounds()
    const area = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + 20 }).workArea
    const room = area.x + area.width - (b.x + b.width)
    const right = room >= SIZE * 3 + GAP * 2
    const y = b.y + Math.round((60 - SIZE) / 2)
    const gearX = right ? b.x + b.width + GAP : b.x - GAP - SIZE
    const syncX = right ? gearX + SIZE : gearX - SIZE // Sync now sits just left of the Pin Manager
    const managerX = right ? syncX + SIZE : syncX - SIZE
    const flyout = this.flyoutOpen
    const width = flyout ? FLYOUT.width : SIZE
    const height = flyout ? FLYOUT.height : SIZE
    // The menu opens downward; if the bubble is near the right edge the window is moved left so it fits.
    const x = Math.min(gearX, area.x + area.width - width)
    this.settings.setBounds({ x, y, width, height }, false)
    this.sync.setBounds({ x: syncX, y, width: SIZE, height: SIZE }, false)
    this.manager.setBounds({ x: managerX, y, width: SIZE, height: SIZE }, false)
  }

  /** For tests. */
  debug(): { settings: Electron.Rectangle; sync: Electron.Rectangle; manager: Electron.Rectangle; visible: boolean } {
    const syncBounds = !this.sync.isDestroyed() ? this.sync.getBounds() : { x: 0, y: 0, width: 0, height: 0 }
    const settingsBounds = !this.settings.isDestroyed() ? this.settings.getBounds() : { x: 0, y: 0, width: 0, height: 0 }
    const managerBounds = !this.manager.isDestroyed() ? this.manager.getBounds() : { x: 0, y: 0, width: 0, height: 0 }
    const visible = !this.gone() && this.settings.isVisible() && this.sync.isVisible() && this.manager.isVisible()
    return { settings: settingsBounds, sync: syncBounds, manager: managerBounds, visible }
  }
}
