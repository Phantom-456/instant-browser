import { app, net, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import { updateReadyNotice, type UpdateState } from '../shared/updateLabel'
import type { Settings } from '../shared/settings'
import { perf } from './perf'
import { latestWindowsTag, releaseFilesUrl, releasesFeedUrl } from '../shared/winUpdateFeed'

/**
 * Windows auto-update stays off until Windows has been tested on a real PC (README, "Updates"). When it is switched
 * on, the check below already reads the right release: the newest win-v one, not the newest Mac one.
 */
export const WINDOWS_AUTO_UPDATE = false

const FIRST_CHECK_MS = 20_000
const EVERY_MS = 6 * 60 * 60_000

/**
 * Checks the GitHub Releases of the project for a newer version, downloads it in the background,
 * and installs it when the app restarts. Works only in the installed app. On Mac the app must be signed.
 * It sends only a normal web request to github.com; nothing about the user.
 */
export class Updater {
  private state: UpdateState = { status: 'disabled', off: 'development', current: app.getVersion() }
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly getSettings: () => Settings,
    /** Called whenever the state changes (the menu and the settings page show it). */
    private readonly onState: (state: UpdateState) => void
  ) {}

  get(): UpdateState {
    return this.state
  }

  start(): void {
    if (!app.isPackaged) return // a development run has nothing to update
    if (process.platform === 'win32' && !WINDOWS_AUTO_UPDATE) return this.set({ status: 'disabled', off: 'windows' })
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', version: info.version }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'idle' }))
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'ready', version: info.version })
      new Notification(updateReadyNotice(info.version, process.platform)).show()
    })
    autoUpdater.on('error', (error) => this.set({ status: 'error', message: String(error?.message ?? error).split('\n')[0]?.slice(0, 140) }))
    this.set({ status: 'idle', off: undefined })
    setTimeout(() => this.checkIfAllowed(), FIRST_CHECK_MS).unref()
    this.timer = setInterval(() => this.checkIfAllowed(), EVERY_MS)
    this.timer.unref()
  }

  /** The user asked ("Check for updates"). Works even when automatic checks are off. */
  checkNow(): void {
    if (!app.isPackaged || ['disabled', 'checking', 'downloading'].includes(this.state.status)) return
    void this.check()
  }

  /** Points the updater at the newest win-v release (see winUpdateFeed.ts), then checks it. */
  private async check(): Promise<void> {
    this.set({ status: 'checking' })
    let tag: string | null
    try {
      const response = await net.fetch(releasesFeedUrl(), { credentials: 'omit', signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
      tag = latestWindowsTag(await response.text())
    } catch (error) {
      this.set({ status: 'error', message: String((error as Error)?.message ?? error).split('\n')[0]?.slice(0, 140) })
      return
    }
    if (!tag) return this.set({ status: 'idle' }) // no Windows release yet: nothing newer than this one
    autoUpdater.setFeedURL({ provider: 'generic', url: releaseFilesUrl(tag) })
    await autoUpdater.checkForUpdates().catch(() => { /* shown through the error event */ })
  }

  installNow(): void {
    if (this.state.status === 'ready') autoUpdater.quitAndInstall()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private checkIfAllowed(): void {
    if (this.getSettings().updateNotice) this.checkNow() // the "automatic updates" switch
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch, current: app.getVersion() }
    perf('updater', this.state.status)
    this.onState(this.state)
  }
}
