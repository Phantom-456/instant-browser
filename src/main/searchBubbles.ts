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
  private readonly manager: BrowserWindow
  private flyoutOpen = false

  constructor(
    private readonly bar: BrowserWindow,
    private readonly handlers: { openSettings: (section: SettingsSection) => void; openManager: () => void; closeBar: () => void }
  ) {
    this.settings = this.make('settings')
    this.manager = this.make('manager')
    bar.on('show', () => { this.place(); this.settings.showInactive(); this.manager.showInactive() })
    bar.on('hide', () => { this.flyoutOpen = false; this.settings.hide(); this.manager.hide() })
    bar.on('resize', () => this.place())
    bar.on('closed', () => { this.settings.destroy(); this.manager.destroy() })

    ipcMain.on(BUBBLE_ACTION, (event, action: BubbleAction) => {
      if (event.sender !== this.settings.webContents && event.sender !== this.manager.webContents) return
      if (!action || typeof action !== 'object') return
      if (action.kind === 'manager') { handlers.closeBar(); handlers.openManager(); return }
      const known = SETTINGS_SECTIONS.find((s) => s === action.section) ?? 'General'
      handlers.closeBar()
      handlers.openSettings(known)
    })
    ipcMain.on(BUBBLE_HOVER, (event, hover: BubbleHover) => {
      if (event.sender !== this.settings.webContents || !hover || hover.kind !== 'settings') return
      this.flyoutOpen = hover.on === true
      this.place()
    })
  }

  private make(kind: 'settings' | 'manager'): BrowserWindow {
    const win = new BrowserWindow({
      width: SIZE, height: SIZE, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
      focusable: false, // using a bubble must not take the keyboard from the search field, or the bar would close
      skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000',
      webPreferences: { preload: preloadPath('bubble'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    const page = rendererPage('bubble')
    if (page.url) void win.loadURL(`${page.url}#${kind}`)
    else if (page.file) void win.loadFile(page.file, { hash: kind })
    return win
  }

  /** Put the bubbles to the right of the bar (to the left if there is no room), level with the text field. */
  place(): void {
    if (this.bar.isDestroyed() || this.settings.isDestroyed() || this.manager.isDestroyed()) return
    const b = this.bar.getBounds()
    const area = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + 20 }).workArea
    const room = area.x + area.width - (b.x + b.width)
    const right = room >= SIZE * 2 + GAP * 2
    const y = b.y + Math.round((60 - SIZE) / 2)
    const gearX = right ? b.x + b.width + GAP : b.x - GAP - SIZE
    const managerX = right ? gearX + SIZE : gearX - SIZE
    const flyout = this.flyoutOpen
    const width = flyout ? FLYOUT.width : SIZE
    const height = flyout ? FLYOUT.height : SIZE
    // The menu opens downward; if the bubble is near the right edge the window is moved left so it fits.
    const x = Math.min(gearX, area.x + area.width - width)
    this.settings.setBounds({ x, y, width, height }, false)
    this.manager.setBounds({ x: managerX, y, width: SIZE, height: SIZE }, false)
  }

  /** For tests. */
  debug(): { settings: Electron.Rectangle; manager: Electron.Rectangle; visible: boolean } {
    return { settings: this.settings.getBounds(), manager: this.manager.getBounds(), visible: this.settings.isVisible() && this.manager.isVisible() }
  }
}
