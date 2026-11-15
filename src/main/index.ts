import { app, dialog, Menu, nativeImage, nativeTheme, Notification, Tray } from 'electron'
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
import { isDefaultBrowser, isTestMode, readModifierMask } from './heldKeys'
import { listDiaProfiles, openInDiaProfile } from './dia'
import { DIA_ID } from '../shared/dia'
import { LINK_KEY_PRESETS, decideRoute } from '../shared/linkRouter'
import { resolveInput } from '../shared/resolveInput'
import { MiniWindowManager } from './miniWindow'
import { SettingsWindow } from './settingsWindow'
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
 * it goes to the main browser, unless the chosen keys are held: then it opens in a mini window.
 */
async function routeLink(url: string): Promise<void> {
  const settings = appSettings
  if (!settings || !miniWindows) return
  const s = settings.get()
  if (!s.linkRouter || !isDefaultBrowser()) return miniWindows.open(url) // router off: always a mini window
  const [mask, browsers] = await Promise.all([readModifierMask(), detectBrowsers()])
  const main = pickMainBrowser(browsers, s.mainBrowserId)
  const required = LINK_KEY_PRESETS.find((p) => p.id === s.linkRouterKeys)?.keys ?? []
  const route = decideRoute({ enabled: true, isDefault: true, required, mask, hasMainBrowser: main !== null })
  if (route === 'mini') miniWindows.open(url)
  else await sendTo(main, url, s.diaProfile)
}

function buildTray(searchBar: SearchBar, openSettings: () => void, updater: () => Updater | null): void {
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
      onShow: () => {
        perf('search bar opens')
        history.refreshIfChanged() // looks at the files only; reads them in another process if they changed
        miniWindows?.noteActivity() // a window is probably needed soon: make sure one is ready
        warmNetwork(settings)
      }
    })
    searchBarRef = searchBar
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
    buildTray(searchBar, () => settingsWindow?.open(), () => updater)
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
  })
  app.on('before-quit', () => {
    // Stop background work first, so nothing answers into windows that are closing.
    historyIndex?.stop()
    updater?.stop()
    miniWindows?.dispose()
  })
  app.on('will-quit', () => unregisterHotkey())
  app.on('window-all-closed', () => {})
}
