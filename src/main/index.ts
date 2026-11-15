import { app, dialog, Menu, nativeImage, nativeTheme, Notification, screen, Tray } from 'electron'
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
let pinManager: PinManager | null = null
let managerWindow: ManagerWindow | null = null

function openFromText(text: string, settings: SettingsFile): void {
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
    dialog.showErrorBox('Instant Browser', `Could not send the page. ${String(error)}`)
  }
}

/**
 * A link arrived from another app. While Instant Browser is the default browser (and the router is on),
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

function buildTray(searchBar: SearchBar, openSettings: () => void, updater: () => Updater | null, pins: () => PinManager | null, openManager: () => void): void {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources/trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Instant Browser')
  const menu = () => {
    const state = updater()?.get()
    const ready = state?.status === 'ready'
    return Menu.buildFromTemplate([
      { label: 'New Search', click: () => searchBar.show() },
      { label: 'Settings', accelerator: 'CommandOrControl+,', click: openSettings },
      pinsMenu(pins()),
      { label: 'Pin Manager', click: openManager },
      { type: 'separator' },
      ready
        ? { label: `Restart to Update to ${state?.version}`, click: () => updater()?.installNow() }
        : { label: 'Check for Updates', enabled: !!state && state.status !== 'disabled', click: () => updater()?.checkNow() },
      { label: `Version ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit Instant Browser', role: 'quit' }
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
    miniWindows = new MiniWindowManager({
      settings,
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
    managerWindow = new ManagerWindow(() => pinManager)
    pinStore.onChange = () => { trayMenuRefresh?.(); managerWindow?.refresh() }
    pinManager = new PinManager({ settings, minis: miniWindows, store: pinStore })
    pinManager.start() // saved pins come back, as border-only pins
    const clampPins = () => pinManager?.clampAll() // a display was added, removed or changed
    screen.on('display-added', clampPins)
    screen.on('display-removed', clampPins)
    screen.on('display-metrics-changed', clampPins)
    if (process.env.INSTANT_TEST_PINS === '1') {
      // tests only
      ;(globalThis as Record<string, unknown>).__pins = pinManager
      ;(globalThis as Record<string, unknown>).__manager = managerWindow
    }
    startLinks() // links clicked before the app was ready open now
    ownHistory = new OwnHistory(join(app.getPath('userData'), 'history.json'))
    let searchBarRef: SearchBar | null = null
    const history = new HistoryIndex(
      () => settings.get(),
      ownHistory,
      join(app.getPath('userData'), 'history-cache.json'),
      () => searchBarRef?.historyChanged()
    )
    historyIndex = history
    setTimeout(() => history.start(), 1200) // old data from the cache at once, then only the files that changed, in another process
    const searchBar = new SearchBar({
      onSubmit: (text) => { perf('enter pressed'); openFromText(text, settings) },
      suggest: (text) => fetchSuggestions(settings, text),
      query: (text) => history.query(text),
      onOpenSettings: (section) => settingsWindow?.open(section),
      onOpenManager: () => managerWindow?.open(),
      onShow: () => {
        perf('search bar opens')
        history.refreshIfChanged() // looks at the files only; reads them in another process if they changed
        miniWindows?.noteActivity() // a window is probably needed soon: make sure one is ready
        warmNetwork(settings)
      }
    })
    searchBarRef = searchBar
    const bubbles = new SearchBubbles(searchBar.window, { openSettings: (section) => settingsWindow?.open(section), openManager: () => managerWindow?.open(), closeBar: () => searchBar.hide() })
    if (process.env.INSTANT_TEST_PINS === '1') { (globalThis as Record<string, unknown>).__bubbles = bubbles; (globalThis as Record<string, unknown>).__searchBar = searchBar } // tests only
    const hotkey = settings.get().hotkey
    const hotkeyOk = registerHotkey(hotkey, () => searchBar.show())
    settingsWindow = new SettingsWindow(
      {
        settings,
        permissions,
        applyHotkey: (accelerator) => registerHotkey(accelerator, () => searchBar.show()),
        pauseHotkey: () => unregisterHotkey(),
        ownHistory,
        refreshHistory: () => history.rescan(),
        refreshWarm: () => miniWindows?.syncWarm(),
        updater: { get: () => updater?.get() ?? ({ status: 'disabled', current: app.getVersion() } as UpdateState), checkNow: () => updater?.checkNow(), installNow: () => updater?.installNow() },
        clearHistoryCache: () => history.clearCache()
      },
      hotkeyOk
    )
    updater = new Updater(() => settings.get(), () => trayMenuRefresh?.())
    buildTray(searchBar, () => settingsWindow?.open(), () => updater, () => pinManager, () => managerWindow?.open())
    if (!hotkeyOk) {
      new Notification({
        title: 'Instant Browser',
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
      void pinManager.prepareQuit().finally(() => app.quit())
      return
    }
    // Stop background work first, so nothing answers into windows that are closing.
    historyIndex?.stop()
    updater?.stop()
    miniWindows?.dispose()
    pinManager?.dispose()
  })
  app.on('will-quit', () => unregisterHotkey())
  app.on('window-all-closed', () => {})
}
