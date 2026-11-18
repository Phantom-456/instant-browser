import { randomUUID } from 'node:crypto'
import { LocalFileGrant, localTarget } from './localFiles'
import { isLocalInput } from '../shared/localInput'
import { BaseWindow, WebContentsView, dialog, session, type Session, ipcMain, nativeImage, nativeTheme, screen, shell, systemPreferences, type Input, type WebContents } from 'electron'
import { PAGE_SWIPE, PAGE_SWIPE_CAN, PREVIEW_ACTION, PREVIEW_STATE, TOOLBAR_ACTION, TOOLBAR_STATE, type PreviewAction, type PreviewState, type ToolbarAction, type ToolbarState } from '../shared/ipc'
import { httpFallback } from '../shared/httpsFirst'
import { placeNear } from '../shared/placement'
import { resolveInput } from '../shared/resolveInput'
import { isAllowedUrl } from '../shared/urlPolicy'
import { preloadPath, rendererPage } from './searchBar'
import type { SettingsFile } from './settingsFile'
import { perf } from './perf'
import { allowHttpFor, getWebSession, hasRunningDownload, wasUpgraded } from './webSession'

const TOOLBAR_HEIGHT = 48
/** Space between the page and the window edge: the glass frame around the page. */
const FRAME = 6
/** How long a window takes to shrink into its pin, and to grow out of it. Slow on purpose; short when the system asks for Reduce Motion. */
const FULL_COLLAPSE_MS = 600
const collapseMs = (): number => {
  try { return systemPreferences.getAnimationSettings().prefersReducedMotion ? 120 : FULL_COLLAPSE_MS } catch { return FULL_COLLAPSE_MS }
}
/** A ready (hidden) window is let go after this long without use. */
const IDLE_RELEASE_MS = 10 * 60_000

function pageBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1c1f' : '#ffffff'
}

type R = { x: number; y: number; width: number; height: number }
const lerpRect = (a: R, b: R, t: number): R => {
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2 // ease in and out
  const k = (x: number, y: number) => Math.round(x + (y - x) * e)
  return { x: k(a.x, b.x), y: k(a.y, b.y), width: Math.max(1, k(a.width, b.width)), height: Math.max(1, k(a.height, b.height)) }
}

/**
 * The window between two sizes while the point `pin` stays fixed on the same spot of the window: the Collapse button (or
 * the pin). The window then shrinks into the pin and grows out of it without the pin ever moving.
 */
const lerpAnchored = (a: R, b: R, pin: { x: number; y: number }, t: number): R => {
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
  const mix = (x: number, y: number) => x + (y - x) * e
  const ax = mix(pin.x - a.x, pin.x - b.x)
  const ay = mix(pin.y - a.y, pin.y - b.y)
  return { x: Math.round(pin.x - ax), y: Math.round(pin.y - ay), width: Math.max(1, Math.round(mix(a.width, b.width))), height: Math.max(1, Math.round(mix(a.height, b.height))) }
}

/** Run `step(t)` for t from 0 to 1 over `ms`, about 60 times a second. */
function animate(ms: number, step: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / ms)
      try { step(t) } catch { /* the window was closed while it moved */ }
      if (t >= 1) { clearInterval(timer); resolve() }
    }, 16)
  })
}

export interface MiniWindowDeps {
  settings: SettingsFile
  /** Send the URL to the main browser. */
  onSend: (url: string) => void
  /** Show a list of browsers. Call done() after one was chosen and the URL was sent. */
  onPickBrowser: (url: string, done: () => void) => void
  /** Open the settings window. */
  onOpenSettings: () => void
  /** The Collapse button was pressed. The window is not hidden yet: the pin manager decides. */
  onCollapse?: (handle: MiniHandle, info: MiniInfo) => void
  /** The star was pressed: bookmark the page, or remove its bookmark. */
  onBookmark?: (url: string, title: string) => void
  isBookmarked?: (url: string) => boolean
  /** A window was opened or closed (sync shares the list of open pages). */
  onWindowsChanged?: () => void
}

/** What the pin manager needs to know about a window. */
export interface MiniInfo {
  url: string
  title: string
  bounds: { x: number; y: number; width: number; height: number }
  following: boolean
}
/** A picture of a page and what is needed to bring it back later. */
export interface MiniSnapshot {
  png: Buffer
  scroll: { x: number; y: number } | null
  /** The user typed text in a field and did not send it. */
  unsentText: boolean
  title: string
  url: string
}

export interface OpenFromPin {
  url: string
  /** Where the window grows from (the pin's centre), how big the pin is, and where the window ends up. */
  from: { x: number; y: number }
  size: number
  to: { x: number; y: number; width: number; height: number }
  following: boolean
  preview: { dataUrl: string; takenAt: number } | null
  scroll: { x: number; y: number } | null
  /** The live page has loaded. */
  onLoaded: () => void
  /** The user pressed Cancel after a failed load. The window is already closed. */
  onCancel: () => void
}

/** An opaque reference to one mini window, for the pin manager. */
export type MiniHandle = MiniWindow

interface MiniWindow {
  localGrant?: LocalFileGrant
  /** A number for the manager list. */
  id: number
  /** The address of the page's icon, when it has one. */
  faviconUrl: string | null
  /** Hidden because it was collapsed to a pin. The page stays alive. */
  collapsed: boolean
  /** The saved preview that covers the page while an offloaded pin loads again. */
  preview: WebContentsView | null
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

let nextMiniId = 0

export class MiniWindowManager {
  private readonly byToolbarId = new Map<number, MiniWindow>()

  constructor(private readonly deps: MiniWindowDeps) {
    // A two-finger swipe in a page (see preload/page.ts): only the page of one of our windows may ask.
    const miniOfPage = (id: number): MiniWindow | undefined => {
      for (const mini of this.byToolbarId.values()) if (!mini.win.isDestroyed() && mini.page.webContents.id === id) return mini
      return undefined
    }
    ipcMain.handle(PAGE_SWIPE_CAN, (event, direction: unknown) => {
      const mini = miniOfPage(event.sender.id)
      if (!mini) return false
      const h = mini.page.webContents.navigationHistory
      return direction === 'back' ? h.canGoBack() : direction === 'forward' ? h.canGoForward() : false
    })
    ipcMain.on(PAGE_SWIPE, (event, direction: unknown) => {
      const mini = miniOfPage(event.sender.id)
      if (!mini) return
      if (direction === 'back') this.handleAction(mini, { type: 'back' })
      else if (direction === 'forward') this.handleAction(mini, { type: 'forward' })
    })
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

  /** The open windows (not pins, not the hidden spare), for the manager list. */
  listOpen(): Array<{ id: number; title: string; url: string }> {
    const out: Array<{ id: number; title: string; url: string }> = []
    for (const mini of this.byToolbarId.values()) {
      if (mini === this.spare || mini.collapsed || mini.win.isDestroyed() || !mini.win.isVisible()) continue
      out.push({ id: mini.id, title: mini.page.webContents.getTitle(), url: currentUrl(mini) })
    }
    return out
  }

  showWindow(id: number): void {
    for (const mini of this.byToolbarId.values()) {
      if (mini.id === id && !mini.win.isDestroyed() && !mini.collapsed) { mini.win.show(); mini.win.focus(); return }
    }
  }

  closeWindow(id: number): void {
    for (const mini of this.byToolbarId.values()) {
      if (mini.id === id && !mini.win.isDestroyed() && !mini.collapsed) { mini.win.close(); return }
    }
  }

  /** Windows the user can see. The hidden spare one is not counted. */
  count(): number {
    let n = 0
    for (const mini of this.byToolbarId.values()) if (mini !== this.spare && !mini.collapsed) n++
    return n
  }

  /**
   * Keep one hidden window ready, so the next one opens at once (its processes, toolbar and web session are
   * already started). A ready window uses about 40 MB of memory, so it is released after 10 minutes without use.
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

  /** Explicit user input is the only entry point that can ask for local access. */
  async openLocal(raw: string): Promise<void> {
    try {
      const target = await localTarget(raw)
      const { response } = await dialog.showMessageBox({
        type: 'question', title: 'Open local file', message: 'Allow this page to read files in this folder until closed?',
        detail: `Page: ${target.path}\n\nFolder: ${target.root}\n\nHTML may run scripts and use the network. Markdown scripts are disabled. Access is not remembered.`,
        buttons: ['Cancel', 'Allow until closed'], defaultId: 0, cancelId: 0, noLink: true
      })
      if (response !== 1 || this.disposed) return
      const id = randomUUID()
      const grant = new LocalFileGrant(target.root, id)
      const isolated = session.fromPartition(`local-${id}`, { cache: false })
      isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      isolated.setPermissionCheckHandler(() => false)
      isolated.on('will-download', (event) => event.preventDefault())
      isolated.protocol.handle('instant-local', (request) => grant.respond(request))
      const mini = this.create(false, { grant, session: isolated })
      this.present(mini, grant.url(target.path))
    } catch (error) {
      dialog.showErrorBox('Could not open local file', String(error))
    }
  }

  /** Build a window, with its toolbar and web page, hidden. Nothing is shown to the user yet. */
  private create(blankPage: boolean, local?: { grant: LocalFileGrant; session: Session }): MiniWindow {
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
      webPreferences: { session: local?.session ?? getWebSession(), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    page.setBorderRadius(12) // the page sits in the glass frame with soft corners
    page.setBackgroundColor(pageBackground()) // no white flash in dark mode while the page loads
    toolbar.setBackgroundColor('#00000000')
    win.contentView.addChildView(page)
    win.contentView.addChildView(toolbar)

    const layout = () => {
      const { width, height } = win.getContentBounds()
      toolbar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT })
      const pageBounds = {
        x: FRAME,
        y: TOOLBAR_HEIGHT,
        width: Math.max(0, width - FRAME * 2),
        height: Math.max(0, height - TOOLBAR_HEIGHT - FRAME)
      }
      page.setBounds(pageBounds)
      mini.preview?.setBounds(pageBounds)
    }
    const mini: MiniWindow = {
      localGrant: local?.grant, win, toolbar, page, layout, id: ++nextMiniId, faviconUrl: null, collapsed: false, preview: null,
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
      this.deps.onWindowsChanged?.()
      this.byToolbarId.delete(toolbarId)
      if (this.spare === mini) this.spare = null
      local?.grant.revoke()
      if (local) {
        local.session.protocol.unhandle('instant-local')
        void local.session.clearStorageData().catch(() => {})
        void local.session.clearCache().catch(() => {})
      }
      page.webContents.close()
      toolbar.webContents.close()
    })

    this.applyPin(mini)
    this.guardPage(mini, local?.grant)

    const wc = page.webContents
    const push = () => this.pushState(mini)
    wc.on('page-favicon-updated', (_event, icons) => { mini.faviconUrl = icons[icons.length - 1] ?? null })
    wc.on('did-navigate', () => { mini.error = null; mini.faviconUrl = null; push() })
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
    this.deps.onWindowsChanged?.()
    perf('mini window: shown')
    wc.once('did-start-loading', () => perf('page: starts loading'))
    wc.once('did-stop-loading', () => perf('page: finished loading'))
    wc.focus()
  }

  /** Rules for the untrusted page: web URLs only, popups become new mini windows. */
  private guardPage(mini: MiniWindow, grant?: LocalFileGrant): void {
    const wc = mini.page.webContents
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedUrl(url)) this.open(url)
      else if (!/^(file|instant-local|javascript|data|chrome|devtools):/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    const block = (event: { preventDefault: () => void }, url: string) => {
      if (grant?.allows(url)) return
      if (isAllowedUrl(url)) {
        if (!grant) return
        event.preventDefault()
        this.open(url)
        return
      }
      event.preventDefault()
      if (!/^(file|instant-local|javascript|data|chrome|devtools):/i.test(url)) void shell.openExternal(url)
    }
    wc.on('will-navigate', (event, url) => block(event, url))
    wc.on('will-redirect', (event, url) => block(event, url))
    if (grant) wc.on('will-frame-navigate', (event) => {
      // Remote documents cannot share a session carrying local-folder access.
      if (!event.isMainFrame && !grant.allows(event.url) && event.url !== 'about:blank') event.preventDefault()
    })
  }

  private applyPin(mini: MiniWindow): void {
    mini.win.setAlwaysOnTop(mini.pinned, 'floating')
    // "visible on all workspaces" is what makes a window follow the user between desktops.
    // visibleOnFullScreen only lets the window sit on top of a full-screen app on the desktop it was opened on.
    mini.win.setVisibleOnAllWorkspaces(mini.following, { visibleOnFullScreen: true })
  }

  /** The bookmarks changed (here or by sync): every toolbar shows the right star. */
  refreshBookmarks(): void {
    for (const mini of this.byToolbarId.values()) if (!mini.win.isDestroyed() && mini !== this.spare) this.pushState(mini)
  }

  // ---- Used by the pin manager ----

  infoOf(mini: MiniHandle): MiniInfo {
    return { url: currentUrl(mini), title: mini.page.webContents.getTitle(), bounds: mini.win.getBounds(), following: mini.following }
  }

  /** Where the Collapse button is on screen (its centre). The pin takes its place, so it stays where the user clicked. */
  async collapseButtonCentre(mini: MiniHandle): Promise<{ x: number; y: number } | null> {
    try {
      const rect = (await mini.toolbar.webContents.executeJavaScript(
        "(() => { const r = document.getElementById('collapse')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()"
      )) as { x: number; y: number } | null
      if (!rect) return null
      const content = mini.win.getContentBounds()
      return { x: Math.round(content.x + rect.x), y: Math.round(content.y + rect.y) }
    } catch {
      return null
    }
  }

  /**
   * The whole window shrinks, slowly, into the pin at `centre` (the circle is `size` wide), then it is hidden. Its page
   * stays alive in memory. The window gets its old size back while hidden, so Restore knows where to grow it again.
   */
  async collapseInto(mini: MiniHandle, centre: { x: number; y: number }, size: number): Promise<void> {
    const win = mini.win
    if (win.isDestroyed()) return
    const from = win.getBounds()
    const to = { x: Math.round(centre.x - size / 2), y: Math.round(centre.y - size / 2), width: size, height: size }
    mini.collapsed = true // it no longer counts as an open window
    mini.ignoreResizeUntil = Date.now() + collapseMs() + 1000
    win.setMinimumSize(1, 1)
    await animate(collapseMs(), (t) => {
      if (win.isDestroyed()) return
      win.setBounds(lerpAnchored(from, to, centre, t))
      win.setOpacity(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3)
    })
    if (win.isDestroyed()) return
    win.hide()
    win.setBounds(from)
    win.setMinimumSize(320, 240)
    win.setOpacity(1)
  }

  /** Show a collapsed window again: it grows out of the pin to the size and place it had, with the page as it was. */
  async reveal(mini: MiniHandle, following: boolean, from: { x: number; y: number }, to: { x: number; y: number; width: number; height: number }, size: number): Promise<void> {
    if (mini.win.isDestroyed()) return
    mini.following = following
    this.applyPin(mini)
    this.pushState(mini)
    await this.grow(mini, from, to, size)
    mini.page.webContents.focus()
  }

  /** The window grows from a small box at `from` to `to`. */
  private async grow(mini: MiniWindow, from: { x: number; y: number }, to: R, size: number): Promise<void> {
    const win = mini.win
    const start = { x: Math.round(from.x - size / 2), y: Math.round(from.y - size / 2), width: size, height: size }
    mini.ignoreResizeUntil = Date.now() + collapseMs() + 1000
    win.setMinimumSize(1, 1)
    win.setOpacity(0)
    win.setBounds(start)
    win.show()
    await animate(collapseMs(), (t) => {
      if (win.isDestroyed()) return
      win.setBounds(lerpAnchored(start, to, from, t))
      win.setOpacity(Math.min(1, t / 0.3))
    })
    if (win.isDestroyed()) return
    win.setBounds(to)
    win.setMinimumSize(320, 240)
    win.setOpacity(1)
    mini.collapsed = false
  }

  /**
   * A picture of the page and what Offload must know before it lets the page go: the scroll position, the title,
   * and whether the user typed text that was not sent. Works on a hidden window too.
   */
  async captureSnapshot(mini: MiniHandle): Promise<MiniSnapshot> {
    const wc = mini.page.webContents
    const image = await wc.capturePage()
    const png = image.toPNG()
    if (image.isEmpty() || png.length === 0) throw new Error('The page gave no picture')
    let scroll: { x: number; y: number } | null = null
    let unsentText = false
    try {
      const info = (await wc.executeJavaScript(
        `(() => ({ x: window.scrollX, y: window.scrollY, unsent: Array.from(document.querySelectorAll('input, textarea')).some((e) => { const t = (e.type || '').toLowerCase(); if (['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'].includes(t)) return false; return (e.value || '') !== (e.defaultValue || '') }) }))()`
      )) as { x: number; y: number; unsent: boolean }
      scroll = { x: info.x, y: info.y }
      unsentText = info.unsent
    } catch { /* a page that cannot be asked: no scroll, no warning */ }
    return { png, scroll, unsentText, title: wc.getTitle(), url: currentUrl(mini) }
  }

  /**
   * The website's own icon as a small picture (a data address), or null when the page has none. It is fetched with the
   * page's own session, shrunk to 64 pixels, and kept only if it is small. A page that has just loaded may not have told
   * us its icon yet, so we wait a moment for it.
   */
  async faviconData(mini: MiniHandle, waitMs = 900): Promise<string | null> {
    const started = Date.now()
    while (!mini.faviconUrl && Date.now() - started < waitMs && !mini.win.isDestroyed()) await new Promise((r) => setTimeout(r, 100))
    const url = mini.faviconUrl
    if (!url || !/^https?:|^data:image\//i.test(url)) return null
    try {
      const response = await getWebSession().fetch(url, { signal: AbortSignal.timeout(3000) })
      if (!response.ok) return null
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length === 0 || bytes.length > 400_000) return null
      if (type === 'image/svg+xml') return bytes.length <= 12_000 ? `data:image/svg+xml;base64,${bytes.toString('base64')}` : null
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) return null
      const { width } = image.getSize()
      const small = width > 64 ? image.resize({ width: 64, quality: 'best' }) : image
      const png = small.toPNG()
      return png.length <= 40_000 ? `data:image/png;base64,${png.toString('base64')}` : null
    } catch {
      return null
    }
  }

  /** Is sound playing from this page? */
  isAudible(mini: MiniHandle): boolean {
    return !mini.win.isDestroyed() && mini.page.webContents.isCurrentlyAudible()
  }

  /** Is a download from this page still running? */
  isDownloading(mini: MiniHandle): boolean {
    return !mini.win.isDestroyed() && hasRunningDownload(mini.page.webContents.id)
  }

  /**
   * Open a window for an offloaded pin: it grows out of the pin, shows the saved preview over the page, loads the address
   * again and fades the preview out when the page is there. Scroll is put back. Retry and Cancel show if the load fails.
   */
  openFromPin(opts: OpenFromPin): MiniHandle {
    this.lastActivity = Date.now()
    const mini = this.spare ?? this.create(false)
    this.spare = null
    mini.collapsed = true
    mini.following = opts.following
    mini.pinned = this.deps.settings.get().alwaysOnTop
    this.applyPin(mini)
    mini.page.setBackgroundColor(pageBackground())
    mini.pendingUrl = opts.url
    mini.starting = true
    mini.error = null
    this.pushState(mini)

    // The saved preview: a picture on top of the page. It is shown first, so the window is never blank.
    let overlay: WebContentsView | null = null
    const send = (state: PreviewState) => { if (overlay && !overlay.webContents.isDestroyed()) overlay.webContents.send(PREVIEW_STATE, state) }
    const state: PreviewState = { image: opts.preview?.dataUrl ?? null, takenAt: opts.preview?.takenAt ?? null, status: 'updating', message: '' }
    if (opts.preview) {
      overlay = new WebContentsView({ webPreferences: { preload: preloadPath('preview'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
      overlay.setBorderRadius(12)
      mini.preview = overlay
      mini.win.contentView.addChildView(overlay)
      mini.layout()
      const view = rendererPage('preview')
      const first = () => send(state)
      overlay.webContents.once('did-finish-load', first)
      if (view.url) void overlay.webContents.loadURL(view.url)
      else if (view.file) void overlay.webContents.loadFile(view.file)
    }
    const removeOverlay = () => {
      const o = overlay
      overlay = null
      mini.preview = null
      if (!o) return
      try { mini.win.contentView.removeChildView(o) } catch { /* the window is gone */ }
      if (!o.webContents.isDestroyed()) o.webContents.close()
    }

    const wc = mini.page.webContents
    let slowTimer: ReturnType<typeof setTimeout> | null = null
    let finished = false
    const clear = () => {
      if (slowTimer) clearTimeout(slowTimer)
      slowTimer = null
      if (successTimer) clearTimeout(successTimer)
      successTimer = null
      wc.removeListener('did-finish-load', onLoaded)
      wc.removeListener('did-fail-load', onFailed)
      ipcMain.removeListener(PREVIEW_ACTION, onAction)
    }
    const start = () => {
      failed = false
      if (successTimer) { clearTimeout(successTimer); successTimer = null }
      state.status = 'updating'
      send(state)
      if (slowTimer) clearTimeout(slowTimer)
      slowTimer = setTimeout(() => { state.status = 'slow'; send(state) }, 8000)
      if (wc.isLoading()) wc.stop()
      void wc.loadURL(opts.url).catch(() => {})
    }
    // A page that cannot load still ends with "finished loading" (Chromium shows its own error page). That is not success: a
    // failure always wins, so the pin is not deleted and Retry and Cancel show.
    let failed = false
    let successTimer: ReturnType<typeof setTimeout> | null = null
    const onLoaded = () => {
      if (finished || failed) return
      if (successTimer) clearTimeout(successTimer)
      successTimer = setTimeout(complete, 150) // a failure that comes just after the finish cancels this
    }
    const complete = () => {
      successTimer = null
      if (finished || failed) return
      finished = true
      clear()
      if (opts.scroll) void wc.executeJavaScript(`window.scrollTo(${Math.round(opts.scroll.x)}, ${Math.round(opts.scroll.y)})`).catch(() => {})
      state.status = 'done'
      send(state) // the preview fades out
      setTimeout(removeOverlay, 220)
      opts.onLoaded()
    }
    const onFailed = (_e: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
      if (!isMainFrame || code === -3 || finished) return
      failed = true
      if (successTimer) { clearTimeout(successTimer); successTimer = null }
      if (slowTimer) clearTimeout(slowTimer)
      state.status = 'failed'
      state.message = `The page did not load (${description}).`
      send(state)
    }
    const onAction = (event: Electron.IpcMainEvent, action: PreviewAction) => {
      if (!overlay || event.sender !== overlay.webContents || !action) return
      if (action.type === 'retry') start()
      else if (action.type === 'cancel') {
        finished = true
        clear()
        removeOverlay()
        this.discard(mini)
        opts.onCancel()
      }
    }
    wc.on('did-finish-load', onLoaded)
    wc.on('did-fail-load', onFailed)
    ipcMain.on(PREVIEW_ACTION, onAction)
    mini.win.once('closed', () => { clear(); finished = true })
    start()
    void this.grow(mini, opts.from, opts.to, opts.size).then(() => { if (!mini.win.isDestroyed()) wc.focus() })
    return mini
  }

  /** Follow on or off for a window that may be hidden (the pin's Follow button). */
  setFollowing(mini: MiniHandle, following: boolean): void {
    mini.following = following
    if (!mini.win.isDestroyed()) {
      this.applyPin(mini)
      this.pushState(mini)
    }
  }

  isAlive(mini: MiniHandle): boolean { return !mini.win.isDestroyed() }

  /** Close a window for good (Remove, or Offload when it frees the page). */
  discard(mini: MiniHandle): void {
    mini.collapsed = false
    if (!mini.win.isDestroyed()) mini.win.close()
  }

  private pushState(mini: MiniWindow): void {
    if (mini.win.isDestroyed()) return
    const wc = mini.page.webContents
    const state: ToolbarState = {
      url: mini.localGrant?.displayPath(currentUrl(mini)) ?? currentUrl(mini),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      following: mini.following,
      bookmarked: this.deps.isBookmarked?.(currentUrl(mini)) ?? false,
      loading: wc.isLoading() || mini.starting,
      error: mini.error
    }
    mini.win.setTitle(state.title || 'Talaria')
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
        if (isLocalInput(action.text)) { void this.openLocal(action.text); break }
        if (url) {
          if (wc.getURL().startsWith('instant-local:')) this.open(url)
          else void wc.loadURL(url)
        }
        break
      }
      case 'collapse':
        if (isAllowedUrl(currentUrl(mini))) this.deps.onCollapse?.(mini, this.infoOf(mini))
        break
      case 'bookmark':
        if (isAllowedUrl(currentUrl(mini))) { this.deps.onBookmark?.(currentUrl(mini), wc.getTitle()); this.pushState(mini) }
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
