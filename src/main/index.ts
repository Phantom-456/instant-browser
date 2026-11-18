import { protocol } from 'electron'
import { isLocalInput } from '../shared/localInput'

protocol.registerSchemesAsPrivileged([{ scheme: 'instant-local', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
import { installQuietWindows } from './testQuiet'
import { app, dialog, Menu, nativeImage, nativeTheme, Notification, powerMonitor, safeStorage, screen, shell, systemPreferences, Tray } from 'electron'
import { join } from 'node:path'
import { registerHotkey, unregisterHotkey } from './hotkey'
import { SearchBar } from './searchBar'
import { SettingsFile } from './settingsFile'
import { PermissionFile } from './permissionFile'
import { initWebSession } from './webSession'
import { Updater } from './updater'
import { updateLabel, type UpdateState } from '../shared/updateLabel'
import { fetchSuggestions } from './suggestions'
import { HistoryIndex } from './historyIndex'
import { BrowserLibrary } from './browserLibrary'
import { matchMergedMarks } from '../shared/browserBookmarks'
import { perf, watchMainThread } from './perf'
import { warmNetwork } from './warmup'
import { OwnHistory } from './ownHistory'
import { isDefaultBrowser, isTestMode, readLinkContext } from './heldKeys'
import { listDiaProfiles, openInDiaProfile } from './dia'
import { DIA_ID } from '../shared/dia'
import { LINK_KEY_PRESETS, decideRoute, isTerminalApp } from '../shared/linkRouter'
import { resolveInput } from '../shared/resolveInput'
import { MiniWindowManager } from './miniWindow'
import { PinManager } from './pins/pinManager'
import { PinStore } from './pins/pinStore'
import { labelOf } from '../shared/pins/model'
import { SettingsWindow } from './settingsWindow'
import { ManagerWindow } from './managerWindow'
import { SearchBubbles } from './searchBubbles'
import { DriveAuth, type TokenStore } from './sync/driveAuth'
import { BookmarkStore } from './bookmarkStore'
import { DriveStorage } from './sync/driveStorage'
import { EncryptedStorage, type KeyStore } from './sync/encryption'
import { SecretFile, SecretKeyStore, isStableSignature, type SecretMode } from './sync/secretFile'
import { spawnSync } from 'node:child_process'
import { SyncManager } from './sync/syncManager'
import { GOOGLE_ENDPOINTS } from '../shared/sync/oauth'
import { installLinkHandler } from './linkHandler'
import { detectBrowsers, openInBrowser } from './browsers'
import { pickMainBrowser, type BrowserInfo } from '../shared/browserCommands'

let tray: Tray | null = null
let trayMenuRefresh: (() => void) | null = null
let updater: Updater | null = null
let miniWindows: MiniWindowManager | null = null
let settingsWindow: SettingsWindow | null = null
let appSettings: SettingsFile | null = null
let ownHistory: OwnHistory | null = null
let historyIndex: HistoryIndex | null = null
let browserLibrary: BrowserLibrary | null = null
let pinManager: PinManager | null = null
let managerWindow: ManagerWindow | null = null
let syncManager: SyncManager | null = null
let bookmarkStore: BookmarkStore | null = null
let searchBarInstance: SearchBar | null = null
let bubblesInstance: SearchBubbles | null = null

function openFromText(text: string, settings: SettingsFile): void {
  if (isLocalInput(text)) { void miniWindows?.openLocal(text); return }
  const url = resolveInput(text, settings.get().searchTemplate)
  if (!url) return
  ownHistory?.record(url) // so the bar can suggest it again
  historyIndex?.noteOwnVisit(url)
  miniWindows?.open(url)
}

async function sendTo(browser: BrowserInfo | null, url: string, profile: string | null = null): Promise<void> {
  try {
    if (!browser) throw new Error('No browser was found on this computer')
    const dia = browser.id === DIA_ID ? profile : null // a Dia profile chosen by the user
    if (isTestMode()) {
      console.log('[instant] sent', browser.id, url, dia ?? '') // tests must not open real browsers
      return
    }
    if (dia && (await openInDiaProfile(url, dia))) return
    await openInBrowser(browser, url) // no profile chosen, or Dia could not do it: open it normally
  } catch (error) {
    dialog.showErrorBox('Talaria', `Could not send the page. ${String(error)}`)
  }
}

/**
 * A link arrived from another app. While Talaria is the default browser (and the router is on),
 * it goes to the main browser, unless the chosen keys are held, or the link comes from a terminal or a code
 * editor: then it opens in a mini window.
 */
async function routeLink(url: string): Promise<void> {
  const settings = appSettings
  if (!settings || !miniWindows) return
  const s = settings.get()
  if (!s.linkRouter || !isDefaultBrowser()) return miniWindows.open(url) // router off: always a mini window
  const [context, browsers] = await Promise.all([readLinkContext(), detectBrowsers()])
  const main = pickMainBrowser(browsers, s.mainBrowserId)
  const required = LINK_KEY_PRESETS.find((p) => p.id === s.linkRouterKeys)?.keys ?? []
  const fromTerminal = s.terminalLinksSmallWindow && isTerminalApp(context.frontApp)
  const route = decideRoute({ enabled: true, isDefault: true, required, mask: context.mask, hasMainBrowser: main !== null, fromTerminal })
  if (route === 'mini') miniWindows.open(url)
  else await sendTo(main, url, s.diaProfile)
}

/** Touch ID can be asked here (a Mac with Touch ID). Tests never ask. */
function touchIdAvailable(): boolean {
  try { return process.platform === 'darwin' && !process.env.INSTANT_TEST_GOOGLE_BASE && systemPreferences.canPromptTouchID() } catch { return false }
}

/** Sync now. If Google Drive is not connected (or needs the passphrase), open the Sync settings instead. */
function syncNowOrSettings(): void {
  const state = syncManager?.status().state
  if (!syncManager || state === 'off' || state === 'error' || state === 'needs-passphrase' || state === 'locked') settingsWindow?.open('Sync')
  else void syncManager.syncNow()
}

function buildTray(searchBar: SearchBar, openSettings: () => void, updater: () => Updater | null, pins: () => PinManager | null, openManager: () => void): void {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources/trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Talaria')
  const menu = () => {
    const state = updater()?.get()
    const ready = state?.status === 'ready'
    return Menu.buildFromTemplate([
      { label: 'New Search', click: () => searchBar.show() },
      { label: 'Settings', accelerator: 'CommandOrControl+,', click: openSettings },
      { label: 'Sync now', click: () => syncNowOrSettings() },
      pinsMenu(pins()),
      { label: 'Manage', click: openManager },
      { type: 'separator' },
      ready
        ? { label: `Restart to Update to ${state?.version}`, click: () => updater()?.installNow() }
        : { label: 'Check for Updates', enabled: !!state && state.status !== 'disabled', click: () => updater()?.checkNow() },
      { label: `Version ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit Talaria', role: 'quit' }
    ])
  }
  tray.setContextMenu(menu())
  // The menu is built again when the update state changes.
  trayMenuRefresh = () => tray?.setContextMenu(menu())
}

/** The Pins list in the menu bar menu: every pin that is not archived, with the same actions as the pin itself. */
function pinsMenu(manager: PinManager | null): Electron.MenuItemConstructorOptions {
  const pins = manager?.pins() ?? []
  const archived = manager?.archived().length ?? 0
  if (!manager || pins.length === 0) return { label: archived ? `Pins (none, ${archived} archived)` : 'Pins (none)', enabled: false }
  return {
    label: `Pins (${pins.length})`,
    submenu: [
      ...pins.map((p) => {
        const resident = p.state === 'resident'
        return {
          label: `${labelOf(p)}${resident ? '' : '  (released)'}`,
          submenu: [
            { label: 'Open', click: () => void manager.act(p.id, 'restore') },
            { label: 'Offload (release the page)', enabled: resident, click: () => void manager.act(p.id, 'offload') },
            { label: 'Remove', click: () => void manager.act(p.id, 'remove') }
          ]
        }
      }),
      { type: 'separator' as const },
      { label: `Archived pins: ${archived}`, enabled: false }
    ]
  }
}

if (process.env.INSTANT_TEST_QUIET === '1') installQuietWindows() // tests only: no flashing windows, no stolen mouse or focus

// The product is called Talaria now, but your settings, pins and sign-ins stay in the folder they were always in.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', join(app.getPath('appData'), 'instant-browser')) // tests and dev runs pass their own folder

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const startLinks = installLinkHandler((url) => void routeLink(url))
  app.whenReady().then(() => {
    watchMainThread()
    perf('app ready')
    if (process.platform === 'darwin') app.dock?.hide()
    if (process.platform === 'win32') app.setAppUserModelId('io.github.phantom-456.instantbrowser') // names the app in Windows notifications and the taskbar
    nativeTheme.themeSource = 'system' // light and dark follow the system, for our pages, the glass and web pages
    const settings = new SettingsFile(join(app.getPath('userData'), 'settings.json'))
    appSettings = settings
    const permissions = new PermissionFile(join(app.getPath('userData'), 'permissions.json'))
    initWebSession({ settings, permissions })
    ownHistory = new OwnHistory(join(app.getPath('userData'), 'history.json'))
    bookmarkStore = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'))
    miniWindows = new MiniWindowManager({
      settings,
      onBookmark: (url, title) => { bookmarkStore?.toggle(url, title) },
      onWindowsChanged: () => { if (appSettings?.get().syncOpenPages) syncManager?.changed() },
      isBookmarked: (url) => bookmarkStore?.has(url) ?? false,
      onOpenSettings: () => settingsWindow?.open(),
      onCollapse: (handle, info) => void pinManager?.collapse(handle, info),
      onSend: (url) => {
        void detectBrowsers().then((all) => sendTo(pickMainBrowser(all, settings.get().mainBrowserId), url, settings.get().diaProfile))
      },
      onPickBrowser: (url, done) => {
        void Promise.all([detectBrowsers(), listDiaProfiles()]).then(([all, liveProfiles]) => {
          const main = pickMainBrowser(all, settings.get().mainBrowserId)
          const profiles = liveProfiles ?? settings.get().diaProfiles
          if (liveProfiles && liveProfiles.join('\n') !== settings.get().diaProfiles.join('\n')) settings.update({ diaProfiles: liveProfiles })
          Menu.buildFromTemplate([
            ...all.map((browser) => {
              const label = browser.id === main?.id ? `${browser.name} (main)` : browser.name
              // Dia: choose the profile (a space of tabs) the page opens in.
              if (browser.id === DIA_ID && profiles.length > 0) {
                const chosen = settings.get().diaProfile
                return {
                  label,
                  submenu: [
                    { label: chosen ? `Chosen profile: ${chosen}` : "Dia's current profile", click: () => { void sendTo(browser, url, chosen).then(done) } },
                    { type: 'separator' as const },
                    ...profiles.map((name) => ({ label: name, click: () => { void sendTo(browser, url, name).then(done) } }))
                  ]
                }
              }
              return { label, click: () => { void sendTo(browser, url).then(done) } }
            }),
            { type: 'separator' as const },
            {
              label: 'Set main browser',
              submenu: all.map((browser) => ({
                label: browser.name,
                type: 'radio' as const,
                checked: browser.id === main?.id,
                click: () => { settings.update({ mainBrowserId: browser.id }) }
              }))
            }
          ]).popup()
        })
      }
    })
    const pinStore = new PinStore(join(app.getPath('userData'), 'pins'))
    managerWindow = new ManagerWindow(() => pinManager, {
      bookmarks: () => (bookmarkStore?.list() ?? []).map((b) => ({ id: b.id, title: b.title, url: b.url, createdAt: b.createdAt, syncOff: b.syncOff === true })),
      devices: () => syncManager?.otherDevices() ?? [],
      openUrl: (url) => miniWindows?.open(url),
      removeBookmark: (id) => bookmarkStore?.remove(id),
      setBookmarkLocal: (id, off) => bookmarkStore?.setSyncOff(id, off),
      history: () => (historyIndex?.pageList(200) ?? []).map((p) => ({ ...p, own: p.sources.includes('Talaria') })),
      deleteHistory: (url) => { if (ownHistory?.remove(url)) historyIndex?.rescan() },
      browserMarks: () => ({ count: browserLibrary?.allMarks().length ?? 0, tree: browserLibrary?.tree() ?? { name: '', folders: [], marks: [] } }),
      tabs: () => browserLibrary?.liveTabs() ?? [],
      editBookmark: (id, title, url) => bookmarkStore?.edit(id, title, url) ?? 'invalid'
    })
    // Google Drive sync (optional). The login key comes from the build (.env.local or the release secrets). Tests point it at a fake Google.
    const fakeGoogle = process.env.INSTANT_TEST_GOOGLE_BASE
    // Secrets (the Google login, the sync key): in the keychain only when the app has a stable signature (see secretFile.ts). Otherwise every
    // update would look like a different app to the keychain and the person would have to connect again. Windows (DPAPI) is stable.
    const secretMode: SecretMode = (() => {
      if (process.platform === 'win32') return 'keychain'
      if (process.platform !== 'darwin' || !app.isPackaged) return 'file'
      const result = spawnSync('codesign', ['-dv', app.getPath('exe')], { encoding: 'utf8' }) // it writes what it finds to stderr
      return isStableSignature(`${result.stdout}${result.stderr}`) ? 'keychain' : 'file'
    })()
    const endpoints = fakeGoogle
      ? { auth: `${fakeGoogle}/auth`, token: `${fakeGoogle}/token`, revoke: `${fakeGoogle}/revoke`, drive: `${fakeGoogle}/drive/v3`, upload: `${fakeGoogle}/upload/drive/v3` }
      : GOOGLE_ENDPOINTS
    const memoryTokens: TokenStore = (() => { let text: string | null = null; return { load: () => text, save: (t) => { text = t }, clear: () => { text = null } } })()
    const driveAuth = new DriveAuth({
      clientId: process.env.INSTANT_TEST_GOOGLE_ID ?? import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.INSTANT_TEST_GOOGLE_SECRET ?? import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? '',
      endpoints,
      fetch: (input, init) => fetch(input, init),
      // The sign-in opens in the normal browser, never inside the app. (A test "browser" just follows the address.)
      openExternal: fakeGoogle ? async (url) => { void fetch(url).catch(() => {}) } : (url) => shell.openExternal(url),
      store: fakeGoogle ? memoryTokens : new SecretFile(join(app.getPath('userData'), 'sync-token.bin'), safeStorage, secretMode)
    })
    // The synced file is locked with a passphrase that only the person knows (end-to-end encryption). Google sees scrambled data.
    const memoryKey: KeyStore = (() => { let v: { key: string; salt: string } | null = null; return { load: () => v, save: (x) => { v = x }, clear: () => { v = null } } })()
    const crypt = new EncryptedStorage(
      new DriveStorage(() => driveAuth.accessToken(), endpoints, (input, init) => fetch(input, init)),
      fakeGoogle ? memoryKey : new SecretKeyStore(new SecretFile(join(app.getPath('userData'), 'sync-key.bin'), safeStorage, secretMode))
    )
    syncManager = new SyncManager({
      keyStorage: secretMode === 'keychain' ? 'keychain' : 'private-file',
      stateFile: join(app.getPath('userData'), 'sync-state.json'),
      settings,
      pins: () => pinManager,
      auth: driveAuth,
      crypt,
      bookmarks: bookmarkStore!,
      ownHistory: ownHistory!,
      openPages: () => [
        ...(miniWindows?.listOpen() ?? []).filter((w) => /^https?:/i.test(w.url)).map((w) => ({ url: w.url, title: w.title, kind: 'window' as const })),
        ...(pinManager?.pins() ?? []).filter((p) => /^https?:/i.test(p.url)).map((p) => ({ url: p.url, title: p.title, kind: 'pin' as const }))
      ].slice(0, 100),
      defaultDeviceName: process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows PC' : 'Computer',
      onData: () => { managerWindow?.refresh(); miniWindows?.refreshBookmarks() },
      verifyUser: touchIdAvailable() ? async () => { try { await systemPreferences.promptTouchID('unlock your synced data'); return true } catch { return false } } : undefined
    })
    bookmarkStore!.onRemoved = (id) => { if (settings.get().syncBookmarks) syncManager?.noteDeleted(id) }
    bookmarkStore!.onChange = () => { miniWindows?.refreshBookmarks(); managerWindow?.refresh(); syncManager?.changed() }
    ownHistory!.onClear = (time) => { if (settings.get().syncHistory) syncManager?.noteHistoryCleared(time) }
    ownHistory!.onRecord = () => { if (settings.get().syncHistory) syncManager?.changed() }
    settings.onChange = () => syncManager?.changed()
    pinStore.onChange = () => { trayMenuRefresh?.(); managerWindow?.refresh(); syncManager?.changed() }
    pinManager = new PinManager({ settings, minis: miniWindows, store: pinStore })
    pinManager.start() // saved pins come back, as border-only pins
    pinManager.onDeletedForever = (id) => syncManager?.noteDeleted(id)
    syncManager.start() // only does anything when Google Drive is connected
    // Sleep and wake: send the latest changes before the computer sleeps (it may give only a moment), and sync again soon after it wakes.
    powerMonitor.on('suspend', () => void syncManager?.flush(3000))
    powerMonitor.on('resume', () => syncManager?.changed())
    powerMonitor.on('unlock-screen', () => syncManager?.changed())
    const clampPins = () => pinManager?.clampAll() // a display was added, removed or changed
    screen.on('display-added', clampPins)
    screen.on('display-removed', clampPins)
    screen.on('display-metrics-changed', clampPins)
    if (process.env.INSTANT_TEST_PINS === '1') {
      // tests only
      ;(globalThis as Record<string, unknown>).__pins = pinManager
      ;(globalThis as Record<string, unknown>).__manager = managerWindow
      ;(globalThis as Record<string, unknown>).__sync = syncManager
      ;(globalThis as Record<string, unknown>).__bookmarks = bookmarkStore
      ;(globalThis as Record<string, unknown>).__ownHistory = ownHistory
    }
    startLinks() // links clicked before the app was ready open now
    const history = new HistoryIndex(
      () => settings.get(),
      ownHistory,
      join(app.getPath('userData'), 'history-cache.json'),
      () => searchBarInstance?.historyChanged()
    )
    historyIndex = history
    // The bookmarks, history files and open tabs of the other browsers: read, watched, and (open tabs) only when switched on.
    browserLibrary = new BrowserLibrary(
      () => settings.get(),
      join(app.getPath('userData'), 'browsers'),
      () => { managerWindow?.refresh(); searchBarInstance?.historyChanged() },
      () => history.refreshNow()
    )
    setTimeout(() => browserLibrary?.start(), 1800)
    setTimeout(() => history.start(), 1200) // old data from the cache at once, then only the files that changed, in another process
    const searchBar = new SearchBar({
      onSubmit: (text) => { perf('enter pressed'); openFromText(text, settings) },
      suggest: (text) => fetchSuggestions(settings, text),
      query: (text) => {
        const limit = text.trim() ? 4 : 5
        const own = (bookmarkStore?.search(text, limit) ?? []).map((b) => ({ title: b.title, url: b.url }))
        const have = new Set(own.map((b) => b.url))
        const others = matchMergedMarks(browserLibrary?.allMarks() ?? [], text, limit).filter((m) => !have.has(m.url)).map((m) => ({ title: m.title || m.url, url: m.url }))
        return { ...history.query(text), bookmarks: [...own, ...others].slice(0, limit) }
      },
      onOpenSettings: (section) => settingsWindow?.open(section),
      onOpenManager: () => managerWindow?.open(),
      onSyncNow: () => syncNowOrSettings(),
      onShow: () => {
        perf('search bar opens')
        history.refreshIfChanged() // looks at the files only; reads them in another process if they changed
        miniWindows?.noteActivity() // a window is probably needed soon: make sure one is ready
        warmNetwork(settings)
      }
    })
    searchBarInstance = searchBar
    const bubbles = new SearchBubbles(searchBar.window, { openSettings: (section) => settingsWindow?.open(section), openManager: () => managerWindow?.open(), closeBar: () => searchBar.hide(), syncNow: () => syncNowOrSettings() })
    bubblesInstance = bubbles
    searchBar.setWindowChangeListener((newWin) => bubbles.attachBar(newWin))
    if (process.env.INSTANT_TEST_PINS === '1') { (globalThis as Record<string, unknown>).__bubbles = bubbles; (globalThis as Record<string, unknown>).__searchBar = searchBar } // tests only
    const hotkey = settings.get().hotkey
    const hotkeyOk = registerHotkey(hotkey, () => searchBar.toggle())
    settingsWindow = new SettingsWindow(
      {
        settings,
        permissions,
        applyHotkey: (accelerator) => registerHotkey(accelerator, () => searchBar.toggle()),
        pauseHotkey: () => unregisterHotkey(),
        ownHistory,
        refreshHistory: () => history.rescan(),
        refreshBrowsers: () => browserLibrary?.settingsChanged(),
        browserInfo: () => ({ bookmarkSources: browserLibrary?.bookmarkSources() ?? [], tabBrowsers: browserLibrary?.tabBrowsers() ?? [] }),
        refreshWarm: () => miniWindows?.syncWarm(),
        updater: { get: () => updater?.get() ?? ({ status: 'disabled', current: app.getVersion() } as UpdateState), checkNow: () => updater?.checkNow(), installNow: () => updater?.installNow() },
        clearHistoryCache: () => history.clearCache(),
        touchIdAvailable: () => touchIdAvailable(),
        sync: {
          status: () => syncManager!.status(),
          connect: () => syncManager!.connect(),
          syncNow: () => syncManager!.syncNow(),
          disconnect: (deleteRemote) => syncManager!.disconnect(deleteRemote),
          setPassphrase: (p) => syncManager!.setPassphrase(p),
          unlock: (p) => syncManager!.unlock(p),
          changePassphrase: (c, n) => syncManager!.changePassphrase(c, n),
          forgetKey: () => syncManager!.forgetKeyHere(),
          makeRecoveryKey: () => syncManager!.makeRecoveryKey(),
          unlockWithRecovery: (k) => syncManager!.unlockWithRecovery(k)
        }
      },
      hotkeyOk
    )
    updater = new Updater(() => settings.get(), () => trayMenuRefresh?.())
    buildTray(searchBar, () => settingsWindow?.open(), () => updater, () => pinManager, () => managerWindow?.open())
    if (!hotkeyOk) {
      new Notification({
        title: 'Talaria',
        body: `The hotkey ${hotkey} is used by another app. Open Settings from the tray menu to choose another key.`
      }).show()
    }
    // Get ready for the first search, a moment after start-up so it does not slow the start.
    setTimeout(() => {
      warmNetwork(settings)
      miniWindows?.warm()
    }, 900)
    updater.start()
    if (process.env.INSTANT_TEST_PIN === '1') void import('./pins/pinTest').then((m) => m.installTestPin(() => settings.get().pinSize))
  })
  let quitReady = false
  app.on('before-quit', (event) => {
    // Pins are saved first: a picture of each live page (at most 2 seconds), then the app quits for real.
    if (!quitReady && pinManager) {
      event.preventDefault()
      quitReady = true
      // Pins are saved first, then the last changes are sent to Drive (at most 4 seconds), then the app quits for real.
      void pinManager.prepareQuit().then(() => syncManager?.flush(4000)).catch(() => {}).finally(() => app.quit())
      return
    }
    // Stop background work first, so nothing answers into windows that are closing.
    searchBarInstance?.prepareQuit()
    bubblesInstance?.prepareQuit()
    historyIndex?.stop()
    browserLibrary?.stop()
    updater?.stop()
    miniWindows?.dispose()
    pinManager?.dispose()
    syncManager?.stop()
  })
  app.on('will-quit', () => unregisterHotkey())
  app.on('window-all-closed', () => {})
}
