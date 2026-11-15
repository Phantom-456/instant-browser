import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { SETTINGS_SECTIONS, type SettingsSection } from '../shared/bubbles'
import {
  SEARCH_CANCEL,
  SEARCH_HISTORY_CHANGED,
  SEARCH_OPEN_MANAGER,
  SEARCH_OPEN_SETTINGS,
  SEARCH_QUERY,
  SEARCH_RESIZE,
  SEARCH_SHOW,
  SEARCH_SUBMIT,
  SEARCH_SUGGEST,
  type BarResults
} from '../shared/ipc'

const WIDTH = 640
const HEIGHT = 60
const MAX_HEIGHT = 520

/** Where a UI page lives: the dev server in `pnpm dev`, a file after a build. */
export function rendererPage(name: 'search' | 'toolbar' | 'settings' | 'pin' | 'preview' | 'manager' | 'bubble'): { url?: string; file?: string } {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev ? { url: `${dev}/${name}/index.html` } : { file: join(__dirname, `../renderer/${name}/index.html`) }
}

export function preloadPath(name: 'search' | 'toolbar' | 'settings' | 'pin' | 'preview' | 'manager' | 'bubble' | 'page'): string {
  return join(__dirname, `../preload/${name}.js`)
}

export interface SearchBarDeps {
  onSubmit: (text: string) => void
  /** Suggestions from the search engine (slow, over the network). */
  suggest: (text: unknown) => Promise<string[]>
  /** History and settings that match (local, instant). */
  query: (text: string) => BarResults
  onOpenSettings: (section: SettingsSection) => void
  onOpenManager: () => void
  /** The bar is about to show. */
  onShow: () => void
}

export class SearchBar {
  private readonly win: BrowserWindow
  /** The window itself, for the bubbles that sit beside it. */
  get window(): BrowserWindow { return this.win }

  constructor(private readonly deps: SearchBarDeps) {
    const { onSubmit, suggest } = deps
    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      // Liquid glass: macOS blurs and tints what is behind the bar. The corners are rounded by the system.
      ...(process.platform === 'darwin'
        ? { vibrancy: 'popover' as const, visualEffectState: 'active' as const, backgroundColor: '#00000000' }
        : { backgroundColor: '#202024' }),
      // A panel can show over a full-screen app on Mac without switching desktops.
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: { preload: preloadPath('search'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    const page = rendererPage('search')
    if (page.url) void this.win.loadURL(page.url)
    else if (page.file) void this.win.loadFile(page.file)

    this.win.on('blur', () => this.hide())
    this.win.on('show', () => deps.onShow()) // whichever way the bar is shown
    ipcMain.handle(SEARCH_SUGGEST, (event, text: unknown) =>
      event.sender === this.win.webContents ? suggest(text) : []
    )
    ipcMain.handle(SEARCH_QUERY, (event, text: unknown) =>
      event.sender === this.win.webContents && typeof text === 'string' && text.length <= 200
        ? deps.query(text)
        : { query: '', settings: [], searches: [], pages: [] }
    )
    ipcMain.on(SEARCH_OPEN_SETTINGS, (event, section: unknown) => {
      if (event.sender !== this.win.webContents) return
      const known = SETTINGS_SECTIONS.find((s) => s === section)
      if (!known) return
      this.hide()
      deps.onOpenSettings(known)
    })
    ipcMain.on(SEARCH_OPEN_MANAGER, (event) => {
      if (event.sender !== this.win.webContents) return
      this.hide()
      deps.onOpenManager()
    })
    // The bar grows to show the suggestions and shrinks back.
    ipcMain.on(SEARCH_RESIZE, (event, height: unknown) => {
      if (event.sender !== this.win.webContents || typeof height !== 'number' || !Number.isFinite(height)) return
      const bounds = this.win.getBounds()
      this.win.setBounds({ ...bounds, height: Math.round(Math.min(Math.max(height, HEIGHT), MAX_HEIGHT)) })
    })
    ipcMain.on(SEARCH_CANCEL, () => this.hide())
    ipcMain.on(SEARCH_SUBMIT, (_event, text: unknown) => {
      this.hide()
      if (typeof text === 'string') onSubmit(text)
    })
  }

  /** The history has new data. If the bar is open it shows it. */
  historyChanged(): void {
    // The window may be gone: the app is quitting while the history process still answers.
    if (this.win.isDestroyed() || !this.win.isVisible() || this.win.webContents.isDestroyed()) return
    this.win.webContents.send(SEARCH_HISTORY_CHANGED)
  }

  show(): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    this.win.setBounds({
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + area.height * 0.24),
      width: WIDTH,
      height: HEIGHT
    })
    this.win.show()
    this.win.focus()
    this.win.webContents.send(SEARCH_SHOW)
  }

  hide(): void {
    if (this.win.isVisible()) this.win.hide()
  }

  /** The hotkey: open the bar, or close it if it is open already. */
  toggle(): void {
    if (this.win.isVisible()) this.hide()
    else this.show()
  }
}
