import { protocol } from 'electron'
import { isLocalInput } from '../shared/localInput'

protocol.registerSchemesAsPrivileged([{ scheme: 'instant-local', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
import { app, dialog, Menu, nativeImage, nativeTheme, Notification, screen, Tray } from 'electron'
import { join } from 'node:path'
import { activeHotkey, onHotkeyChange, readKeyboardRepeatDelay, registerHotkey, unregisterHotkey } from './hotkey'
import { chooseHotkey, hotkeyNotice, trayTooltip } from '../shared/hotkeyChoice'
import { formatAccelerator } from '../shared/accelerator'
import { recolourBitmap, trayColour } from '../shared/trayTint'
import { DEFAULT_SETTINGS } from '../shared/settings'
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
import { launchesAtLogin } from '../shared/loginItem'
import { isDefaultBrowser, isTestMode, readLinkContext, startLinkContextReader, stopLinkContextReader } from './heldKeys'
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
import { useFluentScrollbars } from './winChrome'
import { installLinkHandler } from './linkHandler'
import { detectBrowsers, openInBrowser } from './browsers'
import { pickMainBrowser, type BrowserInfo } from '../shared/browserCommands'
import { createMcpHandler } from '../shared/mcp/protocol'
import { capabilityOf } from '../shared/mcp/settingsPolicy'
import { mcpUrl } from '../shared/mcp/setup'
import { AgentKeys } from './mcp/agentKeys'
import { ActivityLog } from './mcp/activityLog'
import { McpServer } from './mcp/mcpServer'
import { browserTools } from './mcp/tools'
import { agentBookmarkTools } from './mcp/agentTools'
import { windowTools } from './mcp/windowTools'
import { WindowOwners } from './mcp/windowOwners'
import { pinTools } from './mcp/pinTools'
import { pageTools } from './mcp/pageTools'
import { actTools } from './mcp/actTools'
import { settingsTools } from './mcp/settingsTools'
import { SiteApprovalStore } from './mcp/siteApprovalStore'
import { AgentBookmarkStore } from './agentBookmarkStore'
import { downloadLog } from './downloadLog'

let tray: Tray | null = null
let trayMenuRefresh: (() => void) | null = null
let updater: Updater | null = null
let miniWindows: MiniWindowManager | null = null
let settingsWindow: SettingsWindow | null = null
let appSettings: SettingsFile | null = null
let mainBrowserName: string | null = null
let ownHistory: OwnHistory | null = null
let historyIndex: HistoryIndex | null = null
let pinManager: PinManager | null = null
let managerWindow: ManagerWindow | null = null
let searchBarInstance: SearchBar | null = null
let bubblesInstance: SearchBubbles | null = null
let agentStore: AgentBookmarkStore | null = null
let mcpServer: McpServer | null = null
let agentKeys: AgentKeys | null = null
let activityLog: ActivityLog | null = null
let siteApprovals: SiteApprovalStore | null = null
let mcpState: 'off' | 'on' | 'in-use' | 'error' = 'off'

/** Start, stop or move the agent server so it matches the settings. */
async function applyMcp(): Promise<void> {
  const s = appSettings?.get()
  if (!mcpServer || !s) return
  const wanted = s.mcpEnabled ? s.mcpPort : 0
  if (mcpServer.running() && mcpServer.port() !== wanted) await mcpServer.stop()
  if (!wanted) { mcpState = 'off'; return }
  if (mcpServer.running()) { mcpState = 'on'; return }
  const result = await mcpServer.start(wanted)
  mcpState = result === 'ok' ? 'on' : result
}

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
  if (!s.linkRouter || !isDefaultBrowser()) { miniWindows.open(url); return } // router off: always a mini window
  const [context, browsers] = await Promise.all([readLinkContext(), detectBrowsers()])
  const main = pickMainBrowser(browsers, s.mainBrowserId)
  const required = LINK_KEY_PRESETS.find((p) => p.id === s.linkRouterKeys)?.keys ?? []
  const fromTerminal = s.terminalLinksSmallWindow && isTerminalApp(context.frontApp)
  const route = decideRoute({ enabled: true, isDefault: true, required, mask: context.mask, hasMainBrowser: main !== null, fromTerminal })
  if (route === 'mini') miniWindows.open(url)
  else await sendTo(main, url, s.diaProfile)
}

/** The tray icon. On Mac a template picture (the system colours it); on Windows drawn white or black for the taskbar. */
function trayImage(): Electron.NativeImage {
  const path = (name: string) => join(app.getAppPath(), 'resources', name)
  if (process.platform !== 'win32') {
    const icon = nativeImage.createFromPath(path('trayTemplate.png'))
    icon.setTemplateImage(true)
    return icon
  }
  const colour = trayColour(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI)
  const source = nativeImage.createFromPath(path('trayTemplate.png')) // the @2x file comes with it as a second size
  const icon = nativeImage.createEmpty()
  for (const scaleFactor of source.getScaleFactors()) {
    // getSize is in screen points; the raw bitmap is in pixels.
    const size = source.getSize(scaleFactor)
    const width = Math.round(size.width * scaleFactor)
    const height = Math.round(size.height * scaleFactor)
    icon.addRepresentation({ scaleFactor, width, height, buffer: recolourBitmap(source.toBitmap({ scaleFactor }), colour) })
  }
  return icon.isEmpty() ? source : icon
}

function buildTray(searchBar: SearchBar, openSettings: () => void, updater: () => Updater | null, pins: () => PinManager | null, openManager: () => void): void {
  tray = new Tray(trayImage())
  // The tooltip names the hotkey, and follows it when it changes in Settings.
  const tooltip = (active: string | null) => {
    const text = trayTooltip(active, process.platform)
    tray?.setToolTip(text)
    if (isTestMode()) console.log(`[instant] tray tooltip ${JSON.stringify(text)}`)
  }
  tooltip(activeHotkey())
  onHotkeyChange(tooltip)
  if (process.platform === 'win32') {
    // Windows: a left click on a tray icon is expected to do the main thing; the menu stays on the right click.
    tray.on('click', () => searchBar.show())
    // The taskbar can switch between light and dark: draw the icon again in the matching colour.
    nativeTheme.on('updated', () => tray?.setImage(trayImage()))
  }
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

useFluentScrollbars()

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
    // Known before the first right-click, for "Open link in <browser>".
    void detectBrowsers().then((all) => { mainBrowserName = pickMainBrowser(all, settings.get().mainBrowserId)?.name ?? null })
    miniWindows = new MiniWindowManager({
      settings,
      onOpenSettings: () => settingsWindow?.open(),
      mainBrowserName: () => {
        // The menu opens at once, so it uses the last known name and refreshes it for next time.
        void detectBrowsers().then((all) => { mainBrowserName = pickMainBrowser(all, settings.get().mainBrowserId)?.name ?? null })
        return mainBrowserName
      },
      onCollapse: (handle, info) => void pinManager?.collapse(handle, info),
      onSend: (url) => {
        void detectBrowsers().then((all) => sendTo(pickMainBrowser(all, settings.get().mainBrowserId), url, settings.get().diaProfile))
      },
      onPickBrowser: (url, done, at) => {
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
          ]).popup(at)
        })
      }
    })
    // The agent (MCP) server. Off unless the person turned it on in Settings > Agents.
    agentStore = new AgentBookmarkStore(join(app.getPath('userData'), 'agent-bookmarks.json'))
    agentKeys = new AgentKeys(app.getPath('userData'))
    { const legacy = agentKeys.legacyAgent(); agentStore.adoptLegacy(legacy ? { id: legacy.id, name: legacy.name } : null) }
    activityLog = new ActivityLog(join(app.getPath('userData'), 'agent-activity.jsonl'))
    siteApprovals = new SiteApprovalStore(join(app.getPath('userData'), 'agent-site-approvals.json'))
    const windowOwners = new WindowOwners()
    mcpServer = new McpServer({
      auth: (key) => { const a = agentKeys!.byKey(key); return a ? { id: a.id, name: a.name } : null },
      handler: createMcpHandler({
        name: 'instant-browser',
        version: app.getVersion(),
        allowed: (t) => capabilityOf(t.group, settings.get()),
        onChange: (e) => activityLog?.add(e),
        tools: () => [...browserTools({
          history: (filter) => historyIndex?.pageQuery(filter) ?? { total: 0, pages: [], nextOffset: null },
          pins: () => pinManager?.pins() ?? [],
          archivedPins: () => pinManager?.archived() ?? [],
          windows: () => miniWindows?.listOpen() ?? [],
          owners: windowOwners,
          sitePermissions: () => permissions.list(),
          downloads: (limit) => downloadLog.recent(limit)
        }), ...(agentStore ? agentBookmarkTools(agentStore) : []), ...windowTools({
          owners: windowOwners,
          open: (url, opts) => miniWindows?.open(url, opts) ?? null,
          close: (id) => miniWindows?.closeWindow(id) ?? false,
          windows: () => miniWindows?.listOpen() ?? [],
          show: (id) => miniWindows?.showWindow(id) ?? false,
          navigate: (id, url) => miniWindows?.navigateWindow(id, url) ?? false,
          step: (id, dir) => miniWindows?.stepWindow(id, dir) ?? null,
          reload: (id) => miniWindows?.reloadWindow(id) ?? false,
          pins: () => pinManager?.pins() ?? [],
          pinAct: async (id, action) => { await pinManager?.act(id, action) }
        }), ...pinTools({
          pins: () => pinManager?.pins() ?? [],
          archivedPins: () => pinManager?.archived() ?? [],
          maxPins: () => settings.get().maxPins,
          collapse: (id) => miniWindows?.collapseWindow(id) ?? false,
          rename: async (id, text) => { await pinManager?.managerAction({ type: 'rename', id, text }) },
          archive: async (id) => { await pinManager?.managerAction({ type: 'archive', id }) },
          unarchive: async (id) => { await pinManager?.managerAction({ type: 'put-back', id }) }
        }), ...pageTools({
          windowPage: (id) => miniWindows?.pageOf(id) ?? null,
          pinPage: (id) => pinManager?.pageOf(id) ?? null
        }), ...actTools({
          windowPage: (id) => miniWindows?.pageOf(id) ?? null,
          pinPage: (id) => pinManager?.pageOf(id) ?? null,
          approve: async (agent, origin, page) => siteApprovals?.ask(agent, origin, page) ?? false
        }), ...settingsTools({
          get: () => settings.get(),
          update: (patch) => {
            const before = settings.get()
            const after = settings.update(patch)
            settingsWindow?.applyChange(before, after) // same side effects as the Settings window
          }
        })]
      })
    })
    void applyMcp()
    const pinStore = new PinStore(join(app.getPath('userData'), 'pins'))
    managerWindow = new ManagerWindow(() => pinManager, {
      openUrl: (url) => { miniWindows?.open(url) },
      agentFolders: () => (agentStore?.folders() ?? []).map((f) => ({ id: f.id, name: f.name, owner: f.ownerName, allowDelete: f.allowDelete, items: f.items.map((b) => ({ id: b.id, title: b.title, url: b.url })) })),
      agentRemoveItem: (folderId, itemId) => { agentStore?.userRemoveItem(folderId, itemId) },
      agentRemoveFolder: (folderId) => { agentStore?.userRemoveFolder(folderId) },
      agentSetPermission: (folderId, allowDelete) => { try { agentStore?.userSetPermission(folderId, allowDelete) } catch { /* the folder is gone */ } }
    })
    if (agentStore) agentStore.onChange = () => { managerWindow?.refresh() }
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
      ;(globalThis as Record<string, unknown>).__agentFolders = agentStore
    }
    startLinks() // links clicked before the app was ready open now
    ownHistory = new OwnHistory(join(app.getPath('userData'), 'history.json'))
    const history = new HistoryIndex(
      () => settings.get(),
      ownHistory,
      join(app.getPath('userData'), 'history-cache.json'),
      () => searchBarInstance?.historyChanged()
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
    searchBarInstance = searchBar
    const bubbles = new SearchBubbles(searchBar.window, { openSettings: (section) => settingsWindow?.open(section), openManager: () => managerWindow?.open(), closeBar: () => searchBar.hide() })
    bubblesInstance = bubbles
    searchBar.setWindowChangeListener((newWin) => bubbles.attachBar(newWin))
    if (process.env.INSTANT_TEST_PINS === '1') { (globalThis as Record<string, unknown>).__bubbles = bubbles; (globalThis as Record<string, unknown>).__searchBar = searchBar } // tests only
    const hotkey = settings.get().hotkey
    readKeyboardRepeatDelay()
    // The switch in Settings follows what Windows will really do (the user may have switched the app off in Startup apps).
    if (app.isPackaged && !isTestMode()) {
      const atLogin = launchesAtLogin(app.getLoginItemSettings(), process.platform)
      if (atLogin !== settings.get().launchAtLogin) settings.update({ launchAtLogin: atLogin })
    }
    // Windows: the helper that reads held keys for the link router is started only when the router can be used.
    if (settings.get().linkRouter && isDefaultBrowser()) startLinkContextReader()
    // Another app often holds the default key on Windows. When the user never chose a key, try a few others.
    const choice = chooseHotkey(hotkey, DEFAULT_SETTINGS.hotkey, process.platform, (key) => registerHotkey(key, () => searchBar.toggle()))
    if (choice.active && choice.fellBack) settings.update({ hotkey: choice.active }) // saved, so the key stays the same next time
    const hotkeyOk = choice.active !== null
    console.log(`[instant] hotkey ${choice.active ?? 'none'} (tried ${choice.tried.join(', ')})`)
    settingsWindow = new SettingsWindow(
      {
        settings,
        permissions,
        applyHotkey: (accelerator) => registerHotkey(accelerator, () => searchBar.toggle()),
        pauseHotkey: () => unregisterHotkey(),
        ownHistory,
        refreshHistory: () => history.rescan(),
        refreshWarm: () => miniWindows?.syncWarm(),
        updater: { get: () => updater?.get() ?? ({ status: 'disabled', current: app.getVersion() } as UpdateState), checkNow: () => updater?.checkNow(), installNow: () => updater?.installNow() },
        clearHistoryCache: () => history.clearCache(),
        applyMcp: () => void applyMcp(),
        mcp: {
          state: () => mcpState,
          url: () => mcpUrl(settings.get().mcpPort),
          agents: () => agentKeys?.list().map((a) => ({ id: a.id, name: a.name, createdAt: a.createdAt })) ?? [],
          key: (id) => agentKeys?.get(id)?.key ?? '',
          addAgent: (name) => { agentKeys?.add(name) },
          removeAgent: (id) => agentKeys?.remove(id) ?? false,
          rotateAgent: (id) => { agentKeys?.rotate(id) },
          folders: () => agentStore?.folders().map((f) => ({ id: f.id, name: f.name, owner: f.ownerName, allowDelete: f.allowDelete, count: f.items.length })) ?? [],
          removeFolder: (id) => agentStore?.userRemoveFolder(id) ?? false,
          setFolderPermission: (id, allowDelete) => { try { agentStore?.userSetPermission(id, allowDelete) } catch { /* the folder is gone */ } },
          approvals: () => siteApprovals?.approvals() ?? [],
          removeApproval: (agentId, origin) => siteApprovals?.remove(agentId, origin),
          activity: () => activityLog?.recent(20) ?? [],
          clearActivity: () => activityLog?.clear(),
          dropUndo: (time, tool) => activityLog?.dropUndo(time, tool)
        }
      },
      hotkeyOk
    )
    updater = new Updater(() => settings.get(), () => trayMenuRefresh?.())
    buildTray(searchBar, () => settingsWindow?.open(), () => updater, () => pinManager, () => managerWindow?.open())
    const notice = hotkeyNotice(choice, hotkey, (key) => formatAccelerator(key, process.platform), DEFAULT_SETTINGS.hotkey)
    if (notice) new Notification({ title: 'Instant Browser', body: notice }).show()
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
    searchBarInstance?.prepareQuit()
    bubblesInstance?.prepareQuit()
    historyIndex?.stop()
    updater?.stop()
    miniWindows?.dispose()
    pinManager?.dispose()
    void mcpServer?.stop()
  })
  app.on('will-quit', () => {
    unregisterHotkey()
    stopLinkContextReader()
  })
  app.on('window-all-closed', () => {})
}
