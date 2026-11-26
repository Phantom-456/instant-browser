import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFileAtomic } from '../atomicWrite'
import { mergeSettings, type Settings } from '../../shared/settings'
import { planApply } from '../../shared/sync/apply'
import { syncOnce } from '../../shared/sync/engine'
import { hostOf } from '../../shared/bookmarks'
import { checkPassphrase, strengthOf } from '../../shared/sync/passphrase'
import { toSyncPin, portablePrefs, PORTABLE_PREF_KEYS } from '../../shared/sync/portable'
import { AuthError, type DriveAuth } from './driveAuth'
import { LockedError, WrongPassphraseError, type EncryptedStorage } from './encryption'
import type { PinManager } from '../pins/pinManager'
import type { PinRecord } from '../../shared/pins/model'
import type { BookmarkStore } from '../bookmarkStore'
import type { OwnHistory } from '../ownHistory'
import type { SyncBookmark, SyncTab } from '../../shared/sync/portable'
import type { ManagerDevice } from '../../shared/ipc'
import type { SettingsFile } from '../settingsFile'
import type { SyncCounts, SyncSecurity, SyncStatus } from '../../shared/sync/status'

interface SavedState {
  deviceId: string
  /** Pins deleted for good on this computer that other computers must hear about. */
  deleted: string[]
  lastSyncAt: number | null
  /** When the key on this computer was set or last changed, and how strong the passphrase was rated. */
  keySetAt: number | null
  keyRating: string
  /** The app's history was cleared here at this time. */
  historyClearedAt: number
  /** Pages removed from the history here that other computers must hear about. */
  historyRemoved: Array<{ url: string; at: number }>
  /** For each pin or bookmark, what it looked like (as portable data) at the last sync. Only pins that differ are announced as changes. */
  synced: Record<string, string>
}

export interface SyncManagerDeps {
  stateFile: string
  settings: SettingsFile
  pins: () => PinManager | null
  auth: DriveAuth
  /** The shared file, encrypted. One object for the whole run, so the key stays in it. */
  crypt: EncryptedStorage
  bookmarks: BookmarkStore
  ownHistory: OwnHistory
  /** The pages open on this computer (windows and pins). */
  openPages: () => SyncTab[]
  /** The name used when the person has not chosen one. */
  defaultDeviceName: string
  /** Bookmarks, history or the list of other computers changed because of sync. */
  onData?: () => void
  /** Ask the person to prove it is them (Touch ID). Returns false if they cancel. Left out where it is not available. */
  verifyUser?: () => Promise<boolean>
  /** Where secrets are kept on this computer. */
  keyStorage?: 'keychain' | 'private-file'
  now?: () => number
  /** The status changed (the Settings screen listens). */
  onStatus?: () => void
}

/** A host such as example.com is excluded with all its subdomains (www.example.com, docs.example.com). */
export function isExcludedHost(host: string, excluded: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return excluded.some((x) => h === x || h.endsWith('.' + x))
}

const DEBOUNCE_MS = 5000
/** Settings are kept in `synced` under this prefix (pins and bookmarks use their ids, which never start with it). */
const PREF = 'pref:'
const EVERY_MS = 10 * 60_000

/**
 * Keeps this computer's pins and portable settings in step with the shared file in the person's Drive, when they have
 * connected. It runs after a change (a few seconds later), every 10 minutes, and at start. It never blocks the app and
 * never opens a window by itself.
 */
export class SyncManager {
  private saved: SavedState
  private state: SyncStatus['state']
  private message = ''
  private running = false
  private again = false
  private debounce: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private applying = false
  private devices: ManagerDevice[] = []
  /** Something changed here that the shared file does not have yet. */
  private dirty = false
  /** Touch ID was passed in this run. */
  private verified = false
  private changeCounter = 0

  constructor(private readonly deps: SyncManagerDeps) {
    this.saved = this.load()
    this.state = deps.auth.isConnected() ? 'idle' : 'off'
    this.message = this.describe()
  }

  private now = () => (this.deps.now ?? Date.now)()

  private load(): SavedState {
    try {
      const raw = JSON.parse(readFileSync(this.deps.stateFile, 'utf8')) as Partial<SavedState>
      return {
        deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : randomUUID(),
        deleted: Array.isArray(raw.deleted) ? raw.deleted.filter((x): x is string => typeof x === 'string').slice(0, 5000) : [],
        lastSyncAt: typeof raw.lastSyncAt === 'number' ? raw.lastSyncAt : null,
        keySetAt: typeof raw.keySetAt === 'number' ? raw.keySetAt : null,
        keyRating: typeof raw.keyRating === 'string' ? raw.keyRating : '',
        historyClearedAt: typeof raw.historyClearedAt === 'number' ? raw.historyClearedAt : 0,
        historyRemoved: Array.isArray(raw.historyRemoved) ? raw.historyRemoved.filter((r): r is { url: string; at: number } => !!r && typeof r.url === 'string' && Number.isFinite(r.at)).slice(-5000) : [],
        synced: raw.synced && typeof raw.synced === 'object' ? Object.fromEntries(Object.entries(raw.synced).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {}
      }
    } catch {
      return { deviceId: randomUUID(), deleted: [], lastSyncAt: null, keySetAt: null, keyRating: '', historyClearedAt: 0, historyRemoved: [], synced: {} }
    }
  }

  private save(): void {
    try {
      writeFileAtomic(this.deps.stateFile, JSON.stringify(this.saved, null, 2), { mode: 0o600 })
    } catch { /* the next change saves it again */ }
  }

  private describe(): string {
    if (!this.deps.auth.isAvailable()) return 'This build cannot connect to Google Drive.'
    switch (this.state) {
      case 'off': return 'Not connected.'
      case 'connecting': return 'Waiting for you to sign in, in your browser.'
      case 'needs-passphrase': return 'Choose a passphrase to lock your synced data. Nothing is sent until you do.'
      case 'locked': return 'Your synced data is locked. Enter your passphrase to unlock it.'
      case 'syncing': return 'Syncing.'
      case 'offline': return 'Cannot reach Google Drive. It will try again later.'
      case 'error': return this.message || 'Something went wrong.'
      default: return this.saved.lastSyncAt ? `Connected. Last synced ${new Date(this.saved.lastSyncAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Connected.'
    }
  }

  status(): SyncStatus {
    return { available: this.deps.auth.isAvailable(), state: this.state, message: this.state === 'error' ? this.message : this.describe(), lastSyncAt: this.saved.lastSyncAt, security: this.security(), counts: this.counts(), computers: this.devices.map((d) => ({ name: d.name, updatedAt: d.updatedAt })) }
  }

  private security(): SyncSecurity | null {
    if (this.state === 'off' || this.state === 'connecting' || this.state === 'needs-passphrase') return null
    return {
      active: this.state !== 'locked',
      cipher: 'AES-256-GCM',
      kdf: 'scrypt (N=16384, r=8, p=1)',
      keySetAt: this.saved.keySetAt,
      rating: this.saved.keyRating,
      recovery: this.deps.crypt.hasRecovery(),
      keyStorage: this.deps.keyStorage ?? 'private-file'
    }
  }

  private counts(): SyncCounts {
    const sent = (ids: string[]) => ids.filter((id) => id in this.saved.synced).length
    const pins = this.deps.pins()?.records() ?? []
    const marks = this.deps.bookmarks.list()
    const hist = this.deps.ownHistory.items().length
    const pinSynced = sent(pins.filter((p) => !p.syncOff).map((p) => p.id))
    const markSynced = sent(marks.filter((b) => !b.syncOff).map((b) => b.id))
    return {
      pins: { synced: pinSynced, local: pins.length - pinSynced },
      bookmarks: { synced: markSynced, local: marks.length - markSynced },
      history: { synced: this.deps.settings.get().syncHistory ? hist : 0, local: this.deps.settings.get().syncHistory ? 0 : hist }
    }
  }

  private set(state: SyncStatus['state'], message = ''): void {
    this.state = state
    this.message = message
    this.deps.onStatus?.()
  }

  /** Start the timers (if connected). */
  start(): void {
    if (!this.deps.auth.isConnected()) return
    this.schedule(20_000)
    this.interval ??= setInterval(() => void this.syncNow(), EVERY_MS)
    this.interval.unref()
  }

  stop(): void {
    if (this.debounce) clearTimeout(this.debounce)
    if (this.interval) clearInterval(this.interval)
    this.debounce = null
    this.interval = null
  }

  private schedule(ms: number): void {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => { this.debounce = null; void this.syncNow() }, ms)
    this.debounce.unref()
  }

  /** Pins or settings changed here: sync soon. */
  changed(): void {
    if (this.applying || !this.deps.auth.isConnected()) return
    this.dirty = true
    this.changeCounter++
    this.schedule(DEBOUNCE_MS)
  }

  /**
   * Send what has not been sent yet, now, but give up after `budgetMs`. Used when the app quits and when the computer goes to
   * sleep, so the latest changes are in Drive. If there is no network, nothing is lost: the changes stay here and go at the next sync.
   */
  async flush(budgetMs = 4000): Promise<void> {
    if (!this.deps.auth.isConnected() || !(this.dirty || this.debounce)) return
    if (this.debounce) { clearTimeout(this.debounce); this.debounce = null }
    await Promise.race([this.syncNow(), new Promise<void>((resolve) => setTimeout(resolve, budgetMs))])
  }

  /** The pages other computers have open (read from the shared file at the last sync). */
  otherDevices(): ManagerDevice[] { return this.devices }

  /** The app's history was cleared here: the other computers must forget it too. */
  noteHistoryCleared(time: number): void {
    if (!this.deps.auth.isConnected()) return
    this.saved.historyClearedAt = Math.max(this.saved.historyClearedAt, time)
    this.save()
    this.changed()
  }

  /** One page was removed from the app's history here: the other computers must forget it too. */
  noteHistoryRemoved(url: string, time: number): void {
    if (!this.deps.auth.isConnected()) return
    this.saved.historyRemoved = [...this.saved.historyRemoved.filter((r) => r.url !== url), { url, at: time }]
    this.save()
    this.changed()
  }

  /** A pin was deleted for good here. */
  noteDeleted(id: string): void {
    if (!this.deps.auth.isConnected()) return
    if (!this.saved.deleted.includes(id)) this.saved.deleted.push(id)
    this.save()
    this.changed()
  }

  /** Open Google in the browser, wait for the answer, then sync. */
  async connect(): Promise<void> {
    if (this.state === 'connecting') return
    this.set('connecting')
    try {
      await this.deps.auth.connect()
    } catch (error) {
      this.set('error', error instanceof AuthError ? error.message : 'Could not connect. Try again.')
      return
    }
    this.set('idle')
    this.start()
    await this.syncNow()
  }

  /** The first device chooses the passphrase that locks the synced file. It must pass the passphrase rules (length, not common, not a pattern). */
  async setPassphrase(passphrase: string): Promise<void> {
    const check = checkPassphrase(typeof passphrase === 'string' ? passphrase : '')
    if (!check.ok) { this.set('needs-passphrase', check.reason); return }
    this.deps.crypt.setUp(passphrase)
    this.saved.keySetAt = this.now()
    this.saved.keyRating = strengthOf(passphrase)
    this.save()
    this.set('idle')
    await this.syncNow()
  }

  /** Another device: the passphrase that the first device chose. */
  async unlock(passphrase: string): Promise<void> {
    try {
      await this.deps.crypt.unlock(typeof passphrase === 'string' ? passphrase : '')
    } catch (error) {
      this.set('locked', error instanceof WrongPassphraseError ? 'That passphrase does not open the synced data. Try again.' : 'Could not reach Google Drive. Try again.')
      return
    }
    this.saved.keySetAt = this.now()
    this.saved.keyRating = ''
    this.save()
    this.set('idle')
    await this.syncNow()
  }

  /** Make a recovery key and return it (shown once, kept nowhere). Null when it could not be made; the status says why. */
  async makeRecoveryKey(): Promise<string | null> {
    try {
      const key = await this.deps.crypt.makeRecoveryKey()
      if (!key) { this.set('error', 'Your data changed on another computer at the same moment. Try again.'); return null }
      this.set('idle')
      this.deps.onStatus?.()
      return key
    } catch {
      this.set('error', 'Could not make the recovery key. Check your connection and try again.')
      return null
    }
  }

  /** Unlock with the recovery key when the passphrase is lost. */
  async unlockWithRecovery(recoveryKey: string): Promise<void> {
    try {
      await this.deps.crypt.unlockWithRecovery(typeof recoveryKey === 'string' ? recoveryKey : '')
    } catch (error) {
      this.set('locked', error instanceof WrongPassphraseError ? 'That recovery key does not open the synced data. Check it and try again.' : 'Could not reach Google Drive. Try again.')
      return
    }
    this.saved.keySetAt = this.now()
    this.saved.keyRating = ''
    this.save()
    this.set('idle')
    await this.syncNow()
  }

  /** Change the passphrase. The current one is checked first. */
  async changePassphrase(current: string, next: string): Promise<void> {
    const check = checkPassphrase(typeof next === 'string' ? next : '')
    if (!check.ok) { this.set('error', check.reason); return }
    try {
      const ok = await this.deps.crypt.rekey(typeof current === 'string' ? current : '', next)
      if (!ok) { this.set('error', 'Your data changed on another computer at the same moment. Try again.'); return }
    } catch (error) {
      this.set('error', error instanceof WrongPassphraseError ? 'The current passphrase is not right. Nothing was changed.' : 'Could not reach Google Drive. Nothing was changed.')
      return
    }
    this.saved.keySetAt = this.now()
    this.saved.keyRating = strengthOf(next)
    this.save()
    this.set('idle')
    this.deps.onStatus?.()
  }

  /** Remove the key from this computer only. Sync stops here until the passphrase is entered again. Nothing in Drive changes. */
  forgetKeyHere(): void {
    this.deps.crypt.forgetKey()
    this.saved.keySetAt = null
    this.saved.keyRating = ''
    this.save()
    this.set('locked', 'The key was removed from this computer. Enter the passphrase to sync again.')
  }

  async disconnect(deleteRemote: boolean): Promise<void> {
    this.stop()
    let message = ''
    if (deleteRemote && this.deps.auth.isConnected()) {
      try { await this.deps.crypt.remove() } catch { message = 'The synced file could not be deleted from Drive. You can remove the permission at myaccount.google.com/permissions.' }
    }
    await this.deps.auth.disconnect(true)
    this.deps.crypt.forgetKey() // reconnecting later needs the passphrase again
    this.saved.deleted = []
    this.saved.historyRemoved = []
    this.saved.synced = {}
    this.saved.keySetAt = null
    this.saved.keyRating = ''
    this.save()
    this.set(message ? 'error' : 'off', message)
  }

  /** One round of sync now. Never throws. */
  async syncNow(): Promise<void> {
    if (!this.deps.auth.isConnected()) return
    if (this.running) { this.again = true; return }
    const manager = this.deps.pins()
    if (!manager) return
    this.running = true
    const startedAt = this.changeCounter
    this.set('syncing')
    try {
      // With Touch ID on, the person proves it is them once per run before anything is read or sent.
      if (this.deps.settings.get().syncTouchId && this.deps.verifyUser && !this.verified) {
        if (!(await this.deps.verifyUser())) { this.set('locked', 'Touch ID is needed to sync. Press Sync now to try again.'); return }
        this.verified = true
      }
      // Nothing leaves this device unless the file is locked with the passphrase.
      const need = await this.deps.crypt.status()
      if (need !== 'ready') {
        this.set(need === 'locked' ? 'locked' : 'needs-passphrase')
        return
      }
      const settings = this.deps.settings.get()
      const records = manager.records().filter((r) => !r.syncOff) // a pin marked "only on this computer" is never sent
      // Only pins that are new or changed here since the last sync are announced. A pin that did not change is not a "change":
      // if another computer deleted it, it must not come back just because this computer still has it.
      const hashOf = (r: PinRecord) => JSON.stringify(toSyncPin(r))
      const announce = records.filter((r) => this.saved.synced[r.id] !== hashOf(r))
      // Each kind of data has its own switch. A kind that is off is left out: it is neither sent nor taken over.
      const bookmarkList: SyncBookmark[] = this.deps.bookmarks.list().filter((b) => !b.syncOff).map((b) => ({ id: b.id, url: b.url, title: b.title, createdAt: b.createdAt }))
      const bookmarksOn = settings.syncBookmarks
      const historyOn = settings.syncHistory
      const openOn = settings.syncOpenPages
      // Settings work like pins: only a setting changed here since the last sync is a change. Sending every setting each
      // time would put back, with a newer time, a setting that another computer just changed. A setting this computer
      // never synced (it just joined) is used only where the shared file has none yet.
      const prefNow = portablePrefs(settings) as Record<string, unknown>
      const prefChanged: Record<string, unknown> = {}
      const prefDefaults: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(prefNow)) {
        const last = this.saved.synced[PREF + key]
        if (last === undefined) prefDefaults[key] = value
        else if (last !== JSON.stringify(value)) prefChanged[key] = value
      }
      const removedSent = new Set(this.saved.historyRemoved)
      const result = await syncOnce(
        this.deps.crypt,
        {
          pins: announce.map(toSyncPin),
          prefs: prefChanged,
          prefDefaults,
          deleted: this.saved.deleted,
          ...(bookmarksOn ? { bookmarks: bookmarkList.filter((b) => this.saved.synced[b.id] !== JSON.stringify(b)) } : {}),
          ...(historyOn ? { history: this.deps.ownHistory.items().filter((h) => !isExcludedHost(hostOf(h.url), settings.syncHistoryExcluded)), historyClearedAt: this.saved.historyClearedAt, historyRemoved: this.saved.historyRemoved } : {}),
          deviceInfo: openOn ? { name: settings.deviceName || this.deps.defaultDeviceName, tabs: this.deps.openPages() } : null
        },
        this.saved.deviceId,
        this.now()
      )
      if (!result.ok) {
        this.set(result.reason === 'offline' ? 'offline' : 'error', result.reason === 'offline' ? '' : 'Another computer kept changing the file. It will try again later.')
        this.schedule(60_000) // try again in a minute
        return
      }
      this.saved.deleted = [] // the deletions are in the shared file now (as tombstones)
      if (historyOn) this.saved.historyRemoved = this.saved.historyRemoved.filter((r) => !removedSent.has(r)) // a page removed during the sync goes next time
      this.saved.lastSyncAt = this.now()
      for (const r of records) this.saved.synced[r.id] = hashOf(r) // what we sent is what the shared file has now
      if (bookmarksOn) for (const b of bookmarkList) this.saved.synced[b.id] = JSON.stringify(b)
      this.applying = true
      try {
        const plan = planApply(result.doc, manager.records(), this.saved.deviceId, this.deps.bookmarks.list())
        manager.applySync(plan)
        if (bookmarksOn) {
          for (const b of [...plan.bookmarks.add, ...plan.bookmarks.update]) { this.deps.bookmarks.take(b); this.saved.synced[b.id] = JSON.stringify(b) }
          for (const id of plan.bookmarks.remove) { this.deps.bookmarks.drop(id); delete this.saved.synced[id] }
        }
        if (historyOn) this.deps.ownHistory.mergeIn(plan.history, plan.historyClearedAt, plan.historyRemoved)
        this.devices = plan.devices.map((d) => ({ id: d.id, name: d.name, updatedAt: d.updatedAt, tabs: d.tabs }))
        this.deps.onData?.()
        this.applyPrefs(result.doc.prefs, settings)
        for (const key of PORTABLE_PREF_KEYS) {
          const entry = result.doc.prefs[key]
          if (entry) this.saved.synced[PREF + key] = JSON.stringify(entry.value) // what the shared file has now
        }
        for (const sp of [...plan.add, ...plan.update]) {
          const now = manager.records().find((r) => r.id === sp.id)
          if (now) this.saved.synced[sp.id] = hashOf(now) // taken over from the shared file: not a change of ours
        }
        for (const id of plan.remove) delete this.saved.synced[id]
      } finally {
        this.applying = false
      }
      this.save()
      if (this.changeCounter === startedAt) this.dirty = false // nothing changed while we were syncing: all is sent
      this.set('idle')
    } catch (error) {
      if (error instanceof AuthError) this.set('error', error.message)
      else if (error instanceof LockedError || error instanceof WrongPassphraseError) this.set('locked')
      else { this.set('offline'); this.schedule(60_000) }
    } finally {
      this.running = false
      if (this.again) { this.again = false; this.schedule(DEBOUNCE_MS) }
    }
  }

  /** Settings that another computer changed (newer than ours) are taken over; the rest of the settings stay as they are. */
  private applyPrefs(prefs: Record<string, { value: unknown; device: string } | undefined>, current: Settings): void {
    const patch: Record<string, unknown> = {}
    for (const key of PORTABLE_PREF_KEYS) {
      const entry = prefs[key]
      if (entry && entry.device !== this.saved.deviceId && JSON.stringify(entry.value) !== JSON.stringify(current[key])) patch[key] = entry.value
    }
    if (Object.keys(patch).length === 0) return
    const checked = mergeSettings({ ...current, ...patch }) // values from outside are checked and kept in range
    const clean: Record<string, unknown> = {}
    for (const key of Object.keys(patch)) clean[key] = (checked as unknown as Record<string, unknown>)[key]
    this.deps.settings.update(clean as Partial<Settings>)
  }
}
