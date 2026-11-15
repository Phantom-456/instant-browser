import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { PIN_EVENT, PIN_STATE, type PinEvent, type PinView } from '../../shared/ipc'
import { IDLE, isOpen, nextTickAt, stepArming, takesClicks, type ArmEvent, type ArmState } from '../../shared/pins/arming'
import { gradientCss, hslToRgb, luminance, readableText, stopCss } from '../../shared/pins/gradient'
import { SHADOW_MARGIN, armedLayout, chooseSide, restingBounds, type Side } from '../../shared/pins/geometry'
import { clampPoint, labelOf, type PinRecord, type Point, type Rect } from '../../shared/pins/model'
import { prettyUrl } from '../../shared/prettyUrl'
import { preloadPath, rendererPage } from '../searchBar'

/** What a pin window asks the lifecycle to do. */
export type PinOut =
  | { type: 'restore' | 'follow' | 'remove' | 'offload' | 'offload-toggle' | 'offload-resume' }
  | { type: 'moved'; centre: Point }
  | { type: 'rename'; text: string }

export interface PinWindowDeps {
  diameter: () => number
  /** How long the pointer must rest on the pin before it takes clicks. */
  armMs?: () => number
  /** The usable screen area (without the menu bar and the Dock) around a point. */
  workAreaFor: (point: Point) => Rect
  onEvent: (id: string, event: PinOut) => void
  now?: () => number
}

/** After the pointer leaves, the window keeps its large size while the pieces fold back (then it shrinks). */
const SHRINK_AFTER_MS = 220

const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/**
 * One small, see-through, always-on-top window for one collapsed pin. At rest it is just the circle and ignores the
 * mouse (clicks go to the app behind it). When the pointer rests on the circle it grows to hold the description and
 * the three bubbles, ignores clicks for 2 seconds while it "arms", then takes them. The state machine for that is in
 * `shared/pins/arming.ts`; the sizes are in `shared/pins/geometry.ts`.
 */
export class PinWindow {
  readonly win: BrowserWindow
  private arm: ArmState = IDLE
  private side: Side = 'left'
  private dragging = false
  private renaming = false
  private shrinkPending = false
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private shrinkTimer: ReturnType<typeof setTimeout> | null = null
  private drag: { pointer: Point; centre: Point } | null = null
  private ignoring = true
  private countdown: PinView['countdown'] = { mode: 'off', fraction: 1, label: 'Automatic Offload is off' }
  private loaded = false
  private destroyed = false
  private readonly onTheme = (): void => this.push()
  private readonly onPinEvent: (event: Electron.IpcMainEvent, payload: PinEvent) => void

  constructor(private record: PinRecord, private centre: Point, private readonly deps: PinWindowDeps) {
    const rest = restingBounds(centre, deps.diameter())
    this.win = new BrowserWindow({
      ...rest,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false, // a click on a pin must not take the keyboard away from the app you are working in
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: preloadPath('pin'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win.setAlwaysOnTop(true, 'floating')
    this.win.setVisibleOnAllWorkspaces(record.following, { visibleOnFullScreen: true })
    this.win.setIgnoreMouseEvents(true, { forward: true })

    const page = rendererPage('pin')
    if (page.url) void this.win.loadURL(page.url)
    else if (page.file) void this.win.loadFile(page.file)
    this.win.webContents.on('did-finish-load', () => { this.loaded = true; this.push() })

    this.onPinEvent = (event, payload) => {
      if (event.sender === this.win.webContents) this.handle(payload)
    }
    ipcMain.on(PIN_EVENT, this.onPinEvent)
    this.win.once('closed', () => this.cleanup())
    nativeTheme.on('updated', this.onTheme)
  }

  private armMs = (): number => this.deps.armMs?.() ?? 2000
  private now = () => (this.deps.now ?? Date.now)()
  get id(): string { return this.record.id }
  get centrePoint(): Point { return this.centre }
  isDestroyed(): boolean { return this.destroyed || this.win.isDestroyed() }

  /** The pointer is on the pin already (the window was started because of that): start arming at once. */
  hoverNow(): void {
    if (!this.isDestroyed() && this.arm.phase === 'idle') this.step('enter')
  }

  /** Nothing is happening: the pin is closed, nobody drags or renames it. */
  isAtRest(): boolean {
    return this.arm.phase === 'idle' && !this.shrinkPending && !this.dragging && !this.renaming
  }

  /** Call back once the page of the pin window has drawn (the bare shell under it can go then). */
  onReady(callback: () => void): void {
    if (this.loaded) callback()
    else this.win.webContents.once('did-finish-load', () => setTimeout(callback, 60))
  }

  show(): void {
    if (!this.isDestroyed()) this.win.showInactive()
  }

  /** The record changed (name, state, Follow, colours, size setting). */
  update(record: PinRecord): void {
    this.record = record
    if (!this.isDestroyed()) {
      this.win.setVisibleOnAllWorkspaces(record.following, { visibleOnFullScreen: true })
      this.applyBounds()
      this.push()
    }
  }

  /** The countdown on the Offload bubble changed. */
  setCountdown(countdown: PinView['countdown']): void {
    this.countdown = countdown
    this.push()
  }

  /** Move the circle's centre (after a display change, for example). */
  moveTo(centre: Point): void {
    this.centre = centre
    this.applyBounds()
    this.push()
  }

  destroy(): void {
    this.cleanup()
    if (!this.win.isDestroyed()) this.win.destroy()
  }

  private cleanup(): void {
    if (this.destroyed) return
    this.destroyed = true
    ipcMain.removeListener(PIN_EVENT, this.onPinEvent)
    nativeTheme.removeListener('updated', this.onTheme)
    if (this.tickTimer) clearTimeout(this.tickTimer)
    if (this.shrinkTimer) clearTimeout(this.shrinkTimer)
  }

  // ---- Mouse and arming ----

  private handle(event: PinEvent): void {
    if (this.isDestroyed() || !event || typeof event !== 'object') return
    switch (event.type) {
      case 'pointer':
        // While the name is being edited the pin stays open, wherever the pointer is.
        if (typeof event.inside === 'boolean' && !this.dragging && !this.renaming) this.step(event.inside ? 'enter' : 'leave')
        return
      case 'restore':
      case 'follow':
      case 'remove':
      case 'offload':
      case 'offload-toggle':
      case 'offload-resume':
        // Clicks only count once the pin has armed.
        if (takesClicks(this.arm)) this.deps.onEvent(this.record.id, { type: event.type })
        return
      case 'rename-start':
        if (takesClicks(this.arm) && !this.renaming) this.setRenaming(true)
        return
      case 'rename-commit':
        if (this.renaming && typeof event.text === 'string' && event.text.length <= 400) {
          this.setRenaming(false)
          this.deps.onEvent(this.record.id, { type: 'rename', text: event.text })
        }
        return
      case 'rename-cancel':
        if (this.renaming) this.setRenaming(false)
        return
      case 'drag-start':
        if (takesClicks(this.arm) && Number.isFinite(event.x) && Number.isFinite(event.y)) this.startDrag({ x: event.x, y: event.y })
        return
      case 'drag-move':
        if (this.dragging && Number.isFinite(event.x) && Number.isFinite(event.y)) this.moveDrag({ x: event.x, y: event.y })
        return
      case 'drag-end':
        if (this.dragging) this.endDrag()
        return
    }
  }

  /** Editing the name needs the keyboard, so the window may take focus for that time. */
  private setRenaming(on: boolean): void {
    this.renaming = on
    if (this.isDestroyed()) return
    this.win.setFocusable(on)
    if (on) this.win.focus()
    else if (this.arm.phase === 'armed') this.step('leave') // the pointer may be elsewhere now: the usual 200 ms grace, then it closes
    this.push()
  }

  private step(event: ArmEvent): void {
    const before = this.arm
    this.arm = stepArming(this.arm, event, this.now(), this.armMs())
    if (before.phase === 'idle' && this.arm.phase === 'arming') {
      this.side = chooseSide(this.centre, this.deps.diameter(), this.deps.workAreaFor(this.centre)) // locked until the pin closes
      this.shrinkPending = false
      if (this.shrinkTimer) clearTimeout(this.shrinkTimer)
    }
    if (isOpen(before) && !isOpen(this.arm)) this.scheduleShrink()
    this.scheduleTick()
    this.applyBounds()
    this.push()
  }

  private scheduleTick(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer)
    this.tickTimer = null
    const at = nextTickAt(this.arm, this.armMs())
    if (at === null) return
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null
      if (!this.isDestroyed()) this.step('tick')
    }, Math.max(0, at - this.now()) + 5)
  }

  private scheduleShrink(): void {
    this.shrinkPending = true
    if (this.shrinkTimer) clearTimeout(this.shrinkTimer)
    this.shrinkTimer = setTimeout(() => {
      this.shrinkTimer = null
      this.shrinkPending = false
      if (this.isDestroyed()) return
      this.applyBounds()
      this.push()
    }, SHRINK_AFTER_MS)
  }

  // ---- Dragging the pin ----

  private startDrag(pointer: Point): void {
    this.dragging = true
    this.drag = { pointer, centre: this.centre }
    this.arm = IDLE // the pieces fold away while the pin is carried
    this.shrinkPending = false
    if (this.tickTimer) clearTimeout(this.tickTimer)
    this.applyBounds()
    this.push()
  }

  private moveDrag(pointer: Point): void {
    if (!this.drag) return
    const raw = { x: this.drag.centre.x + pointer.x - this.drag.pointer.x, y: this.drag.centre.y + pointer.y - this.drag.pointer.y }
    const d = this.deps.diameter()
    this.centre = clampPoint(raw, [this.deps.workAreaFor(raw)], d / 2 + SHADOW_MARGIN / 2)
    this.applyBounds()
  }

  private endDrag(): void {
    this.dragging = false
    this.drag = null
    this.arm = { phase: 'armed' } // the pointer is still on the circle
    this.side = chooseSide(this.centre, this.deps.diameter(), this.deps.workAreaFor(this.centre)) // chosen again at the new place
    this.deps.onEvent(this.record.id, { type: 'moved', centre: this.centre })
    this.applyBounds()
    this.push()
  }

  // ---- Size, position and what the page shows ----

  private layout() {
    const d = this.deps.diameter()
    const open = !this.dragging && (isOpen(this.arm) || this.shrinkPending)
    if (open) return { ...armedLayout(this.centre, d, this.deps.workAreaFor(this.centre), this.side), open: true as const }
    const bounds = restingBounds(this.centre, d)
    return { bounds, circle: { x: SHADOW_MARGIN, y: SHADOW_MARGIN, width: d, height: d }, open: false as const }
  }

  private applyBounds(): void {
    if (this.isDestroyed()) return
    const layout = this.layout()
    if (!same(this.win.getBounds(), layout.bounds)) this.win.setBounds(layout.bounds, false)
    const wantIgnore = !(takesClicks(this.arm) || this.dragging)
    if (wantIgnore !== this.ignoring) {
      this.ignoring = wantIgnore
      if (wantIgnore) this.win.setIgnoreMouseEvents(true, { forward: true })
      else this.win.setIgnoreMouseEvents(false)
    }
  }

  view(): PinView {
    const layout = this.layout()
    const stops = this.record.gradient.stops
    const mid = stops[Math.floor(stops.length / 2)]!
    const label = labelOf(this.record)
    return {
      id: this.record.id,
      label,
      address: prettyUrl(this.record.url),
      following: this.record.following,
      icon: this.record.icon,
      state: this.record.state,
      gradient: gradientCss(this.record.gradient),
      accent: stopCss(stops[0]!),
      stops: stops.map(stopCss),
      angle: this.record.gradient.angle,
      dark: nativeTheme.shouldUseDarkColors,
      armMs: this.armMs(),
      ink: readableText(luminance(hslToRgb(mid.h, mid.s, mid.l))),
      phase: this.arm.phase,
      dragging: this.dragging,
      renaming: this.renaming,
      customLabel: this.record.label ?? '',
      countdown: this.countdown,
      d: this.deps.diameter(),
      circle: layout.circle,
      parts: layout.open
        ? { side: layout.descriptionSide, description: layout.description, follow: layout.follow, offload: layout.offload, remove: layout.remove }
        : null
    }
  }

  private push(): void {
    if (this.isDestroyed() || !this.loaded) return
    this.win.webContents.send(PIN_STATE, this.view())
  }

  /** For tests: what the window is doing now. */
  debug(): { phase: string; ignoring: boolean; bounds: Rect; dragging: boolean } {
    return { phase: this.arm.phase, ignoring: this.ignoring, bounds: this.win.getBounds(), dragging: this.dragging }
  }
}
