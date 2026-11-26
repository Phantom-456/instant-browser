import { dialog, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { generateGradient } from '../../shared/pins/gradient'
import { activePins, archivedPins, archivePin, clampPoint, clampRect, createPin, labelOf, normalizeLabel, windowForPin, type GradientSpec, type PinRecord, type Point, type Rect } from '../../shared/pins/model'
import type { MiniHandle, MiniInfo, MiniWindowManager } from '../miniWindow'
import type { SettingsFile } from '../settingsFile'
import type { PinFacts } from '../../shared/pins/offloadPolicy'
import { PinAutomation } from './pinAutomation'
import { statSync } from 'node:fs'
import { isTestMode } from '../heldKeys'
import { gradientCss } from '../../shared/pins/gradient'
import type { ManagerAction, ManagerRow, ManagerView } from '../../shared/ipc'
import { PinStore } from './pinStore'
import { PinSurface } from './pinSurface'
import type { PinWindow, PinOut } from './pinWindows'

export interface PinManagerDeps {
  settings: SettingsFile
  minis: MiniWindowManager
  store: PinStore
}

/** The live part of a pin. `mini` is the hidden window with its page (resident), or null once the page was released (offloaded). */
interface Live {
  mini: MiniHandle | null
  pin: PinSurface
}

export type OffloadResult = { ok: true } | { ok: false; reason: 'busy' | 'unsaved' | 'audible' | 'no-snapshot' | 'not-resident' }

const workAreaFor = (p: Point): Rect => screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).workArea

/**
 * The life of every pin: Collapse a window to a pin, Restore it, Offload its page, Remove it (to the archive).
 * Restart recovery and the automatic rules are added in the next slices.
 * One lock per pin: a second request while one is running is ignored, never run twice.
 */
export class PinManager {
  private readonly live = new Map<string, Live>()
  /** The colours and id a window had before it was restored, so collapsing it again gives the same pin. */
  private readonly remembered = new WeakMap<object, { id: string; gradient: GradientSpec; restoredAt: number }>()
  readonly automation: PinAutomation
  private readonly busy = new Set<string>()

  constructor(private readonly deps: PinManagerDeps) {
    this.automation = new PinAutomation(
      {
        facts: () => this.facts(),
        offload: (id, opts) => this.offload(id, opts),
        showCountdown: (id, view) => this.live.get(id)?.pin.setCountdown(view)
      },
      deps.settings
    )
    this.automation.start()
    // A released pin has no page process. Where the pointer is decides when it gets one (see pinSurface.ts).
    if (process.env.INSTANT_TEST_NO_POLL !== '1') {
      this.hoverTimer = setInterval(() => this.pollHoverAt(screen.getCursorScreenPoint()), 100)
      this.hoverTimer.unref()
    }
  }
  private hoverTimer: ReturnType<typeof setInterval> | null = null

  // ---- Start-up and the screen ----

  /**
   * Bring the saved pins back. A live page cannot survive a restart, so every pin comes back as an offloaded pin
   * (border only), with its saved picture. A pin that was resident when the app was killed has no fresh picture: it
   * still opens, from its address.
   */
  start(): void {
    for (const record of this.pins()) {
      const d = this.diameter()
      const centre = clampPoint(record.pin, [workAreaFor(record.pin)], d / 2)
      const next = this.deps.store.update(record.id, (p) => ({
        ...p, state: 'offloaded', pin: centre, window: clampRect(p.window, [workAreaFor(centre)], 8)
      }))
      if (!next) continue
      const pin = this.makePinWindow(next, centre)
      this.live.set(record.id, { mini: null, pin })
      pin.show()
    }
  }

  /** A display was added, removed or changed: every pin and every saved window comes back onto a screen you can see. */
  clampAll(): void {
    const d = this.diameter()
    for (const [id, live] of this.live) {
      const record = this.deps.store.get(id)
      if (!record) continue
      const centre = clampPoint(live.pin.centrePoint, [workAreaFor(live.pin.centrePoint)], d / 2)
      const next = this.deps.store.update(id, (p) => ({ ...p, pin: centre, window: clampRect(p.window, [workAreaFor(centre)], 8) }))
      if (next) { live.pin.moveTo(centre); live.pin.update(next) }
    }
  }

  /** The same actions as the pin's own buttons, for the menu bar list (and for anyone who cannot use the mouse). */
  async act(id: string, action: 'restore' | 'offload' | 'remove'): Promise<void> {
    await this.onPinEvent(id, { type: action })
  }

  // ---- The manager window ----

  private row(p: PinRecord): ManagerRow {
    let bytes = 0
    try { bytes = p.snapshotAt !== null ? statSync(this.deps.store.snapshotPath(p.id)).size : 0 } catch { bytes = 0 }
    return {
      id: p.id, icon: p.icon, label: labelOf(p), customLabel: p.label ?? '', url: p.url, state: p.state, archived: p.archived, archivedAt: p.archivedAt,
      following: p.following, gradient: gradientCss(p.gradient), createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, snapshotAt: p.snapshotAt,
      pictureBytes: bytes, scrollY: p.scroll ? Math.round(p.scroll.y) : null
    }
  }

  managerView(): Omit<ManagerView, 'agentFolders'> {
    const all = this.deps.store.all()
    return {
      pins: activePins(all).map((p) => this.row(p)),
      archive: archivedPins(all).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)).map((p) => this.row(p)),
      windows: this.deps.minis.listOpen(),
      platform: process.platform,
      maxPins: this.deps.settings.get().maxPins
    }
  }

  /** A request from the manager window. Each one says exactly what it does; "delete" is the only one that cannot be undone. */
  async managerAction(action: ManagerAction): Promise<void> {
    switch (action.type) {
      case 'open': return this.act(action.id, 'restore')
      case 'offload': return this.act(action.id, 'offload')
      case 'archive': return this.act(action.id, 'remove')
      case 'follow': return void (await this.onPinEvent(action.id, { type: 'follow' }))
      case 'rename': return void (await this.onPinEvent(action.id, { type: 'rename', text: String(action.text ?? '').slice(0, 400) }))
      case 'put-back': return this.putBack(action.id)
      case 'delete': return this.deleteForever(action.id)
      case 'show-window': this.deps.minis.showWindow(action.windowId); return
      case 'close-window': this.deps.minis.closeWindow(action.windowId); return
    }
  }

  /** An archived pin comes back on the screen as a released pin. */
  private putBack(id: string): void {
    const record = this.deps.store.get(id)
    if (!record || !record.archived || this.live.has(id)) return
    if (this.pins().length >= this.deps.settings.get().maxPins) return // the manager shows the limit; nothing is put back over it
    const centre = clampPoint(record.pin, [workAreaFor(record.pin)], this.diameter() / 2)
    const next = this.deps.store.update(id, (p) => ({ ...p, archived: false, archivedAt: null, state: 'offloaded', pin: centre, lastUsedAt: Date.now() }))
    if (!next) return
    const pin = this.makePinWindow(next, centre)
    this.live.set(id, { mini: null, pin })
    pin.show()
  }

  /** The only action that cannot be undone: the record and its saved picture are deleted. The manager asks first. */
  private async deleteForever(id: string): Promise<void> {
    const record = this.deps.store.get(id)
    if (!record || !record.archived) return // only archived pins can be deleted for good
    this.deps.store.delete(id)
  }

  /** What the automatic rules need to know about each pin that has a live page. */
  facts(): PinFacts[] {
    const out: PinFacts[] = []
    for (const [id, live] of this.live) {
      const record = this.deps.store.get(id)
      if (!record || !live.mini || record.state !== 'resident' || !this.deps.minis.isAlive(live.mini)) continue
      out.push({
        id,
        resident: true,
        lastUsedAt: record.lastUsedAt,
        restoredAt: record.restoredAt,
        userPaused: false,
        audible: this.deps.minis.isAudible(live.mini),
        downloading: this.deps.minis.isDownloading(live.mini)
      })
    }
    return out
  }

  private diameter = () => this.deps.settings.get().pinSize

  /** All pins that are not archived. */
  pins(): PinRecord[] { return activePins(this.deps.store.all()) }

  // ---- Collapse ----

  /** Turn an open window into a pin. The page stays alive, hidden. */
  async collapse(mini: MiniHandle, info: MiniInfo): Promise<void> {
    const { settings, store, minis } = this.deps
    const known = this.remembered.get(mini)
    if (known && this.busy.has(known.id)) return
    if (this.pins().length >= settings.get().maxPins) {
      await dialog.showMessageBox({
        type: 'info',
        message: `You have ${settings.get().maxPins} pins. That is the limit.`,
        detail: 'Remove a pin, or raise the limit in Settings. A pin with a live page uses about 20 MB.',
        buttons: ['OK']
      })
      return
    }
    const id = known?.id ?? randomUUID()
    this.busy.add(id)
    try {
      const d = this.diameter()
      // The pin takes the place of the Collapse button the user clicked: it stays where it is, and the window shrinks into it.
      const button = await minis.collapseButtonCentre(mini)
      const want = button ?? { x: info.bounds.x + info.bounds.width / 2, y: info.bounds.y + info.bounds.height / 2 }
      const centre = clampPoint(want, [workAreaFor(want)], d / 2)
      const gradient = known?.gradient ?? generateGradient(store.all().map((p) => p.gradient))
      const icon = await minis.faviconData(mini) // the website's own icon, if it has one
      const now = Date.now()
      const record: PinRecord = {
        ...createPin({ url: info.url, title: info.title, window: info.bounds, pin: centre, following: info.following, gradient, icon, anchor: { x: Math.round(centre.x - info.bounds.x), y: Math.round(centre.y - info.bounds.y) } }, id, now),
        restoredAt: known?.restoredAt ?? null // a window that was just restored is not offloaded for 5 minutes
      }
      store.put(record)
      const pin = this.makePinWindow(record, centre)
      this.live.set(id, { mini, pin })
      await minis.collapseInto(mini, centre, d)
      pin.show()
    } finally {
      this.busy.delete(id)
    }
  }

  private makePinWindow(record: PinRecord, centre: Point): PinSurface {
    return new PinSurface(record, centre, {
      diameter: this.diameter,
      armMs: () => this.deps.settings.get().pinArmMs,
      workAreaFor,
      onEvent: (id, event) => void this.onPinEvent(id, event)
    })
  }

  // ---- What a pin asks for ----

  private async onPinEvent(id: string, event: PinOut): Promise<void> {
    if (this.busy.has(id)) return
    this.busy.add(id)
    try {
      switch (event.type) {
        case 'restore': return await this.restore(id)
        case 'follow': return this.toggleFollow(id)
        case 'remove': return this.remove(id)
        case 'rename': {
          const label = normalizeLabel(event.text)
          const next = this.deps.store.update(id, (p) => ({ ...p, label }))
          if (next) this.live.get(id)?.pin.update(next)
          return
        }
        case 'moved':
          this.deps.store.update(id, (p) => ({ ...p, pin: event.centre }))
          return
        case 'offload':
          await this.offloadLocked(id, { ask: true })
          return
        case 'offload-toggle':
          this.automation.toggle(id)
          return
        case 'offload-resume':
          this.automation.resume(id)
          return
      }
    } finally {
      this.busy.delete(id)
    }
  }

  // ---- Restore ----

  /** The pin was clicked: show the window again. The pin goes away. */
  private async restore(id: string): Promise<void> {
    const live = this.live.get(id)
    const record = this.deps.store.get(id)
    if (!live || !record) return
    if (record.state === 'offloaded' || !live.mini) return this.restoreOffloaded(id, live, record)
    if (!this.deps.minis.isAlive(live.mini)) return this.dropPin(id)
    this.remembered.set(live.mini, { id, gradient: record.gradient, restoredAt: Date.now() })
    this.automation.forget(id)
    const centre = live.pin.centrePoint
    live.pin.destroy()
    this.live.delete(id)
    this.deps.store.delete(id)
    // The window grows out of the pin and opens with its Collapse button on the pin, wherever the pin is now.
    await this.deps.minis.reveal(live.mini, record.following, centre, this.windowAt(record, centre), this.diameter())
  }

  /**
   * The page was released. A new window grows out of the pin, shows the saved preview, and loads the address again.
   * The pin record stays until the page has loaded; if the user cancels a failed load, the pin comes back as it was.
   */
  private restoreOffloaded(id: string, live: Live, record: PinRecord): void {
    const { minis, store } = this.deps
    const centre = live.pin.centrePoint
    let preview: { dataUrl: string; takenAt: number } | null = null
    if (record.snapshotAt !== null) {
      try {
        preview = { dataUrl: `data:image/png;base64,${readFileSync(store.snapshotPath(id)).toString('base64')}`, takenAt: record.snapshotAt }
      } catch { /* the picture is gone: the window opens without it */ }
    }
    live.pin.destroy()
    this.live.delete(id)
    const mini = minis.openFromPin({
      url: record.url,
      from: centre,
      size: this.diameter(),
      to: this.windowAt(record, centre),
      following: record.following,
      preview,
      scroll: record.scroll,
      onLoaded: () => { store.delete(id) },
      onCancel: () => {
        // Back to a pin with the page released.
        const again = store.get(id)
        if (!again) return
        const pin = this.makePinWindow(again, centre)
        this.live.set(id, { mini: null, pin })
        pin.show()
      }
    })
    this.remembered.set(mini, { id, gradient: record.gradient, restoredAt: Date.now() })
    this.automation.forget(id)
  }

  /** Where the window opens for this pin: its button on the pin, kept inside the screen. */
  private windowAt(record: PinRecord, centre: Point): Rect {
    return clampRect(windowForPin(record.window, record.anchor, centre), [workAreaFor(centre)], 0)
  }

  /** Follow is one setting shared by the pin and the window behind it. */
  private toggleFollow(id: string): void {
    const live = this.live.get(id)
    const record = this.deps.store.update(id, (p) => ({ ...p, following: !p.following }))
    if (!record) return
    if (live) {
      if (live.mini) this.deps.minis.setFollowing(live.mini, record.following)
      live.pin.update(record)
    }
  }

  // ---- Offload ----

  /** Release the page of a collapsed pin to free memory. The pin stays, as a border only. */
  async offload(id: string, opts: { ask: boolean }): Promise<OffloadResult> {
    if (this.busy.has(id)) return { ok: false, reason: 'busy' }
    this.busy.add(id)
    try {
      return await this.offloadLocked(id, opts)
    } finally {
      this.busy.delete(id)
    }
  }

  /**
   * The safe order: take a picture and read the scroll position first; write them to disk; only then close the window
   * and its page. If anything fails the pin stays resident and nothing is lost. `ask` is true for a manual Offload:
   * it asks before it drops text the user typed and did not send.
   */
  private async offloadLocked(id: string, opts: { ask: boolean }): Promise<OffloadResult> {
    const { minis, store } = this.deps
    const live = this.live.get(id)
    const record = store.get(id)
    if (!live || !record || !live.mini || record.state !== 'resident') return { ok: false, reason: 'not-resident' }
    if (!minis.isAlive(live.mini)) { this.dropPin(id); return { ok: false, reason: 'not-resident' } }
    try {
      const snap = await minis.captureSnapshot(live.mini)
      if (snap.unsentText) {
        if (!opts.ask) return { ok: false, reason: 'unsaved' }
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          message: 'This page has text you typed and did not send.',
          detail: 'If you offload the page, that text is lost. The page loads again from its address when you open the pin.',
          buttons: ['Keep the page', 'Offload anyway'],
          defaultId: 0,
          cancelId: 0
        })
        if (response !== 1) return { ok: false, reason: 'unsaved' }
      }
      const file = store.snapshotPath(id)
      writeFileSync(file, snap.png, { mode: 0o600 })
      chmodSync(file, 0o600)
      const next = store.update(id, (p) => ({
        ...p, state: 'offloaded', snapshotAt: Date.now(), scroll: snap.scroll, title: snap.title || p.title, url: snap.url || p.url
      }))
      if (!next) return { ok: false, reason: 'no-snapshot' }
      minis.discard(live.mini) // only now is the page let go
      live.mini = null
      this.automation.forget(id)
      live.pin.update(next)
      live.pin.setCountdown({ mode: 'off', fraction: 1, label: 'The page is released' })
      return { ok: true }
    } catch (error) {
      if (isTestMode()) console.log('[instant] offload failed', error instanceof Error ? error.stack : String(error))
      await dialog.showMessageBox({
        type: 'error',
        message: 'Could not offload this page.',
        detail: 'The page is still open in memory and nothing was lost. You can try again.',
        buttons: ['OK']
      })
      return { ok: false, reason: 'no-snapshot' }
    }
  }

  // ---- Remove ----

  /** Remove takes the pin off the screen and keeps its record in the archive (a soft delete). */
  private remove(id: string): void {
    const live = this.live.get(id)
    if (live) {
      live.pin.destroy()
      if (live.mini) this.deps.minis.discard(live.mini)
      this.live.delete(id)
    }
    // The page is gone, so the archived pin is a released one. It has no new picture: opening it loads the address.
    this.deps.store.update(id, (p) => archivePin({ ...p, state: 'offloaded' }, Date.now()))
  }

  private dropPin(id: string): void {
    this.live.get(id)?.pin.destroy()
    this.live.delete(id)
    this.deps.store.delete(id)
  }

  // ---- Quitting ----

  /**
   * The app is about to quit. Live pages cannot survive a restart, so every resident pin is saved as an offloaded one:
   * a picture is taken (best effort, at most 2 seconds in all) and the record is marked offloaded.
   */
  async prepareQuit(budgetMs = 2000): Promise<void> {
    const work = Promise.all(
      [...this.live.entries()].map(async ([id, live]) => {
        const record = this.deps.store.get(id)
        if (!record || record.state !== 'resident' || !live.mini || !this.deps.minis.isAlive(live.mini)) return
        try {
          const snap = await this.deps.minis.captureSnapshot(live.mini)
          const file = this.deps.store.snapshotPath(id)
          writeFileSync(file, snap.png, { mode: 0o600 })
          chmodSync(file, 0o600)
          this.deps.store.update(id, (p) => ({ ...p, state: 'offloaded', snapshotAt: Date.now(), scroll: snap.scroll, title: snap.title || p.title, url: snap.url || p.url }))
        } catch {
          // No picture: the pin is still saved as offloaded and reloads from its address.
          this.deps.store.update(id, (p) => ({ ...p, state: 'offloaded' }))
        }
      })
    )
    await Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, budgetMs))])
    // Whatever did not finish in time is still saved as offloaded, without a fresh picture.
    for (const [id] of this.live) this.deps.store.update(id, (p) => (p.state === 'resident' ? { ...p, state: 'offloaded' } : p))
  }

  /** The app is quitting. */
  dispose(): void {
    this.automation.stop()
    if (this.hoverTimer) clearInterval(this.hoverTimer)
    for (const { pin } of this.live.values()) pin.destroy()
    this.live.clear()
  }

  /** Archived (removed) pins. The Alpha 03 manager will list them. */
  archived(): PinRecord[] { return archivedPins(this.deps.store.all()) }

  /** For tests. */
  liveIds(): string[] { return [...this.live.keys()] }
  /** The real pin window of a pin (it is started if the pin only had its bare shell). */
  windowOf(id: string): PinWindow | undefined { return this.live.get(id)?.pin.ensureWindow() }
  /** Tests: which form is the pin in (a real window with a page process, or the bare shell)? */
  surfaceState(id: string): { window: boolean; shell: boolean } | null {
    const s = this.live.get(id)?.pin
    return s ? { window: s.hasWindow(), shell: s.hasShell() } : null
  }
  /** Does this pin have a page process of its own right now? */
  hasPinWindow(id: string): boolean { return !!this.live.get(id)?.pin.hasWindow() }
  /** Tests: act as if the pointer were here. */
  pollHoverAt(point: Point, now = Date.now()): void { for (const live of this.live.values()) live.pin.poll(point, now) }
  /** The live page of a pin (read-only use): null when there is no such pin, 'offloaded' when its page was released. */
  pageOf(id: string): Electron.WebContents | null | 'offloaded' {
    const live = this.live.get(id)
    if (!live) return null
    if (!live.mini || !this.deps.minis.isAlive(live.mini)) return 'offloaded'
    return live.mini.page.webContents
  }
  hasPage(id: string): boolean { return !!this.live.get(id)?.mini }
  tickAutomation(now = Date.now()): Promise<void> { return this.automation.tick(now) }
}
