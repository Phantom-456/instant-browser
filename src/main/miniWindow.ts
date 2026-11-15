import { BaseWindow, WebContentsView, dialog, ipcMain, nativeTheme, screen, shell, type Input, type WebContents } from 'electron'
import { TOOLBAR_ACTION, TOOLBAR_STATE, type ToolbarAction, type ToolbarState } from '../shared/ipc'
import { httpFallback } from '../shared/httpsFirst'
import { placeNear } from '../shared/placement'
import { resolveInput } from '../shared/resolveInput'
import { isAllowedUrl } from '../shared/urlPolicy'
import { preloadPath, rendererPage } from './searchBar'
import type { SettingsFile } from './settingsFile'
import { perf } from './perf'
import { allowHttpFor, getWebSession, wasUpgraded } from './webSession'

const TOOLBAR_HEIGHT = 48
/** Space between the page and the window edge: the glass frame around the page. */
const FRAME = 6
/** A ready (hidden) window is let go after this long without use. */
const IDLE_RELEASE_MS = 10 * 60_000

function pageBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1c1f' : '#ffffff'
}

export interface MiniWindowDeps {
  settings: SettingsFile
  /** Send the URL to the main browser. */
  onSend: (url: string) => void
  /** Show a list of browsers. Call done() after one was chosen and the URL was sent. */
  onPickBrowser: (url: string, done: () => void) => void
  /** Open the settings window. */
  onOpenSettings: () => void
}

interface MiniWindow {
  win: BaseWindow
  toolbar: WebContentsView
  page: WebContentsView
  /** Place the two views inside the window. */
  layout: () => void
  /** Stays above other apps. */
  pinned: boolean
  /** Shows on every desktop, so it follows the user. Off by default: the window stays on the desktop it was opened on. */
  following: boolean
  error: string | null
  /** The address the window was opened with. It is shown until the page has an address of its own. */
  pendingUrl: string
  /** Opened, but the page has not started to load yet. */
  starting: boolean
  /** Window size changes before this time are ours, not the user's. */
  ignoreResizeUntil: number
}

/** The address of the page, or the address it was opened with while the page has none yet. */
function currentUrl(mini: { page: WebContentsView; pendingUrl: string }): string {
  const now = mini.page.webContents.getURL()
  return now && now !== 'about:blank' ? now : mini.pendingUrl
}

export class MiniWindowManager {
  private readonly byToolbarId = new Map<number, MiniWindow>()

  constructor(private readonly deps: MiniWindowDeps) {
    ipcMain.on(TOOLBAR_ACTION, (event, action: ToolbarAction) => {
      const mini = this.byToolbarId.get(event.sender.id)
      if (mini) this.handleAction(mini, action)
    })
  }

  private spare: MiniWindow | null = null
  private warmTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = Date.now()
  private disposed = false

  /** Windows the user can see. The hidden spare one is not counted. */
  count(): number {
    let n = 0
    for (const mini of this.byToolbarId.values()) if (mini !== this.spare) n++
    return n
  }

  /**
   * Keep one hidden window ready, so the next one opens at once (its processes, toolbar and web session are
   * already started). A ready window uses about 180 MB of memory, so it is released after 10 minutes without use.
   */
  warm(): void {
    if (this.disposed || this.spare || !this.deps.settings.get().warmWindow) return
    perf('mini window: spare is made')
    this.spare = this.create(true)
    this.idleTimer ??= setInterval(() => {
      if (this.spare && Date.now() - this.lastActivity > IDLE_RELEASE_MS) this.releaseSpare()
    }, 60_000)
    this.idleTimer.unref()
  }

  /** The user opened the search bar: a window is probably needed in a few seconds. */
  noteActivity(): void {
    this.lastActivity = Date.now()
    if (!this.disposed && !this.spare && this.deps.settings.get().warmWindow && !this.warmTimer) {
      this.warmTimer = setTimeout(() => {
        this.warmTimer = null
        this.warm()
      }, 1500)
    }
  }

  /** The app is quitting: no new windows, no more timers. */
  dispose(): void {
    this.disposed = true
    if (this.warmTimer) clearTimeout(this.warmTimer)
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.warmTimer = null
    this.idleTimer = null
  }

  /** After the setting "keep a window ready" changed. */
  syncWarm(): void {
    if (this.deps.settings.get().warmWindow) this.warm()
    else this.releaseSpare()
  }

  private releaseSpare(): void {
    const spare = this.spare
    this.spare = null
    if (spare && !spare.win.isDestroyed()) spare.win.close()
    perf('mini window: spare is released')
  }

  open(url: string): void {
    if (!isAllowedUrl(url)) return
    perf('mini window: open called', this.spare ? '(a ready window is used)' : '(no ready window: a new one is made)')
    this.lastActivity = Date.now()
    const mini = this.spare ?? this.create(false)
    this.spare = null
    this.present(mini, url)
    // A new spare is made a moment later, not while this window starts.
    if (!this.disposed && this.deps.settings.get().warmWindow && !this.warmTimer) {
      this.warmTimer = setTimeout(() => {
        this.warmTimer = null
        this.warm()
      }, 1500)
    }
  }

  /** Build a window, with its toolbar and web page, hidden. Nothing is shown to the user yet. */
  private create(blankPage: boolean): MiniWindow {
    const settings = this.deps.settings.get()
    const win = new BaseWindow({
      width: settings.windowSize.width,
      height: settings.windowSize.height,
      show: false,
      minWidth: 320,
      minHeight: 240,
      skipTaskbar: false,
      ...(process.platform === 'darwin'
        ? {
            // Mac style: the standard red, yellow and green buttons sit on top of our toolbar.
            titleBarStyle: 'hidden' as const,
            // Liquid glass: the window blurs and tints what is behind it. Our toolbar is see-through on top of it.
            vibrancy: 'under-window' as const,
            visualEffectState: 'active' as const,
            backgroundColor: '#00000000',
            trafficLightPosition: { x: 14, y: (TOOLBAR_HEIGHT - 12) / 2 },
            fullscreenable: false // the green button zooms the window, as in a small utility window
          }
        : { frame: false })
    })

    const toolbar = new WebContentsView({
      webPreferences: { preload: preloadPath('toolbar'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    const page = new WebContentsView({
      webPreferences: { session: getWebSession(), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    page.setBorderRadius(12) // the page sits in the glass frame with soft corners
    page.setBackgroundColor(pageBackground()) // no white flash in dark mode while the page loads
    toolbar.setBackgroundColor('#00000000')
    win.contentView.addChildView(page)
    win.contentView.addChildView(toolbar)

    const layout = () => {
      const { width, height } = win.getContentBounds()
      toolbar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT })
      page.setBounds({
        x: FRAME,
        y: TOOLBAR_HEIGHT,
        width: Math.max(0, width - FRAME * 2),
        height: Math.max(0, height - TOOLBAR_HEIGHT - FRAME)
      })
    }
    const mini: MiniWindow = {
      win, toolbar, page, layout,
      pinned: settings.alwaysOnTop, following: false, error: null,
      pendingUrl: '', starting: false, ignoreResizeUntil: 0
    }
    const toolbarId = toolbar.webContents.id
    this.byToolbarId.set(toolbarId, mini)

    layout()
    win.on('resize', () => {
      layout()
      // Remember the size the user chose. Not when we place the window ourselves, and not for a hidden window.
      if (!win.isVisible() || Date.now() < mini.ignoreResizeUntil) return
      const { width, height } = win.getBounds()
      this.deps.settings.update({ windowSize: { width, height } })
    })
    win.on('closed', () => {
      this.byToolbarId.delete(toolbarId)
      if (this.spare === mini) this.spare = null
      page.webContents.close()
      toolbar.webContents.close()
    })

    this.applyPin(mini)
    this.guardPage(mini)

    const wc = page.webContents
    const push = () => this.pushState(mini)
    wc.on('did-navigate', () => { mini.error = null; push() })
    wc.on('did-navigate-in-page', push)
    wc.on('page-title-updated', push)
    wc.on('did-start-loading', () => { mini.starting = false; push() })
    wc.on('did-stop-loading', () => { mini.starting = false; push() })
    wc.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
      // -3 means the load was stopped on purpose (for example by a new navigation).
      if (!isMainFrame || code === -3) return
      mini.starting = false
      const plain = wasUpgraded(failedUrl) ? httpFallback(failedUrl) : null
      if (plain) {
        const host = new URL(plain).hostname
        void dialog
          .showMessageBox(win, {
            type: 'warning',
            message: `${host} does not support a safe (https) connection.`,
            detail: 'Other people on the network could read or change what you see and type on this site.',
            buttons: ['Go back', 'Open anyway'],
            defaultId: 0,
            cancelId: 0
          })
          .then(({ response }) => {
            if (response !== 1) return
            allowHttpFor(host)
            void wc.loadURL(plain).catch(() => {})
          })
      }
      mini.error = `Page did not load (${description})`
      push()
    })
    wc.on('dom-ready', () => wc.setZoomFactor(this.deps.settings.get().defaultZoom))
    wc.on('before-input-event', (event, input) => this.handleShortcut(mini, event, input))
    toolbar.webContents.on('before-input-event', (event, input) => this.handleShortcut(mini, event, input))
    toolbar.webContents.on('did-finish-load', push)

    const toolbarPage = rendererPage('toolbar')
    if (toolbarPage.url) void toolbar.webContents.loadURL(toolbarPage.url)
    else if (toolbarPage.file) void toolbar.webContents.loadFile(toolbarPage.file)
    // A window that waits (the spare) starts its page process now, with an empty page, so it is ready when an address comes.
    if (blankPage) void wc.loadURL('about:blank').catch(() => {})
    return mini
  }

  /** Show a built window at the cursor with an address. The toolbar shows the address and a loader at once. */
  private present(mini: MiniWindow, url: string): void {
    const settings = this.deps.settings.get()
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea
    // Shift each new window a little so windows do not hide each other.
    const shift = (Math.max(0, this.count() - 1) % 8) * 24
    const bounds = placeNear({ x: cursor.x + shift, y: cursor.y + shift }, settings.windowSize, area)
    mini.ignoreResizeUntil = Date.now() + 500
    mini.win.setBounds(bounds)
    mini.layout()
    mini.pinned = settings.alwaysOnTop
    mini.following = false
    this.applyPin(mini)
    mini.page.setBackgroundColor(pageBackground())

    mini.pendingUrl = url
    mini.starting = true
    mini.error = null
    this.pushState(mini) // the address and the loader show before the page starts

    const wc = mini.page.webContents
    if (wc.isLoading()) wc.stop() // the empty page of a spare that is still starting must not win over the real address
    void wc.loadURL(url).catch(() => {}) // a refused or stopped load is shown by the error strip
    mini.win.show()
    perf('mini window: shown')
    wc.once('did-start-loading', () => perf('page: starts loading'))
    wc.once('did-stop-loading', () => perf('page: finished loading'))
    wc.focus()
  }

  /** Rules for the untrusted page: web URLs only, popups become new mini windows. */
  private guardPage(mini: MiniWindow): void {
    const wc = mini.page.webContents
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedUrl(url)) this.open(url)
      else void shell.openExternal(url) // for example mailto: or msteams:
      return { action: 'deny' }
    })
    const block = (event: { preventDefault: () => void }, url: string) => {
      if (isAllowedUrl(url)) return
      event.preventDefault()
      if (!/^(file|javascript|data|chrome|devtools):/i.test(url)) void shell.openExternal(url)
    }
    wc.on('will-navigate', (event, url) => block(event, url))
    wc.on('will-redirect', (event, url) => block(event, url))
  }

  private applyPin(mini: MiniWindow): void {
    mini.win.setAlwaysOnTop(mini.pinned, 'floating')
    // "visible on all workspaces" is what makes a window follow the user between desktops.
    // visibleOnFullScreen only lets the window sit on top of a full-screen app on the desktop it was opened on.
    mini.win.setVisibleOnAllWorkspaces(mini.following, { visibleOnFullScreen: true })
  }

  private pushState(mini: MiniWindow): void {
    if (mini.win.isDestroyed()) return
    const wc = mini.page.webContents
    const state: ToolbarState = {
      url: currentUrl(mini),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      pinned: mini.pinned,
      following: mini.following,
      loading: wc.isLoading() || mini.starting,
      error: mini.error
    }
    mini.win.setTitle(state.title || 'Instant Browser')
    mini.toolbar.webContents.send(TOOLBAR_STATE, state)
  }

  private handleAction(mini: MiniWindow, action: ToolbarAction): void {
    const wc = mini.page.webContents
    switch (action.type) {
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
        break
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
        break
      case 'reload':
        if (wc.isLoading()) wc.stop()
        else wc.reload()
        break
      case 'navigate': {
        const url = resolveInput(action.text, this.deps.settings.get().searchTemplate)
        if (url) void wc.loadURL(url)
        break
      }
      case 'pin':
        mini.pinned = !mini.pinned
        this.applyPin(mini)
        this.pushState(mini)
        break
      case 'follow':
        mini.following = !mini.following
        this.applyPin(mini)
        this.pushState(mini)
        break
      case 'send':
        if (isAllowedUrl(currentUrl(mini))) {
          this.deps.onSend(currentUrl(mini))
          mini.win.close()
        }
        break
      case 'pick-browser':
        if (isAllowedUrl(currentUrl(mini))) this.deps.onPickBrowser(currentUrl(mini), () => mini.win.close())
        break
      case 'close':
        mini.win.close()
        break
    }
  }

  private handleShortcut(mini: MiniWindow, event: { preventDefault: () => void }, input: Input): void {
    if (input.type !== 'keyDown') return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (!mod) return
    const key = input.key.toLowerCase()
    const run = (action: ToolbarAction) => {
      event.preventDefault()
      this.handleAction(mini, action)
    }
    if (input.shift && key === 'm') return run({ type: 'send' })
    if (input.shift && key === 'o') return run({ type: 'pick-browser' })
    if (key === 'w') return run({ type: 'close' })
    if (key === 'r') return run({ type: 'reload' })
    if (key === '[') return run({ type: 'back' })
    if (key === ']') return run({ type: 'forward' })
    if (key === ',') {
      event.preventDefault()
      this.deps.onOpenSettings()
      return
    }
    if (key === 'l') {
      event.preventDefault()
      mini.toolbar.webContents.focus()
      void mini.toolbar.webContents.executeJavaScript("document.getElementById('url').focus()")
    }
  }
}

/** Used by tests and the link handler to know which WebContents are web pages. */
export function isPageContents(wc: WebContents): boolean {
  return wc.session === getWebSession()
}
