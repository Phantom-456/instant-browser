import { app, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/updateLabel'
import type { Settings } from '../shared/settings'
import { perf } from './perf'

const FIRST_CHECK_MS = 20_000
const EVERY_MS = 6 * 60 * 60_000

/**
 * Checks the GitHub Releases of the project for a newer version, downloads it in the background,
 * and installs it when the app restarts. Works only in the installed app. On Mac the app must be signed.
 * It sends only a normal web request to github.com; nothing about the user.
 */
export class Updater {
  private state: UpdateState = { status: 'disabled', current: app.getVersion() }
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
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', version: info.version }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'idle' }))
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'ready', version: info.version })
      new Notification({
        title: 'Instant Browser update is ready',
        body: `Version ${info.version} is downloaded. Use the menu bar icon, "Restart to update".`
      }).show()
    })
    autoUpdater.on('error', (error) => this.set({ status: 'error', message: String(error?.message ?? error).split('\n')[0]?.slice(0, 140) }))
    this.set({ status: 'idle' })
    setTimeout(() => this.checkIfAllowed(), FIRST_CHECK_MS).unref()
    this.timer = setInterval(() => this.checkIfAllowed(), EVERY_MS)
    this.timer.unref()
  }

  /** The user asked ("Check for updates"). Works even when automatic checks are off. */
  checkNow(): void {
    if (!app.isPackaged || this.state.status === 'checking' || this.state.status === 'downloading') return
    void autoUpdater.checkForUpdates().catch(() => { /* shown through the error event */ })
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
