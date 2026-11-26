import type { PinView } from '../../shared/ipc'
import type { PinRecord, Point } from '../../shared/pins/model'
import { PinShell } from './pinShell'
import { PinWindow, type PinWindowDeps } from './pinWindows'

/** How long a released pin must be at rest (pointer gone) before its page process is let go again. */
const DEMOTE_AFTER_MS = Number(process.env.INSTANT_TEST_DEMOTE_MS ?? 1200)
/** The pointer is "on" the pin this close to the edge of the circle (points). */
const NEAR = 4

/**
 * What the user sees as one pin on the desktop. Two forms, so a released pin costs almost no memory:
 *  - a live page behind the pin (resident): always a real pin window (a page process of about 20 MB, as the page is alive anyway);
 *  - a released page (offloaded): a bare shell with no page process while nobody touches it. When the pointer comes on it,
 *    a real pin window starts (the capsule, the arming border, the buttons). When the pointer has been away for a moment,
 *    the window is closed and the shell is back.
 * Everything else in the program talks to this one object and does not care which form it is in.
 */
export class PinSurface {
  private win: PinWindow | null = null
  private shell: PinShell | null = null
  private centre: Point
  private restSince: number | null = null
  private lastCountdown: PinView['countdown'] | null = null
  private destroyed = false
  private shown = false

  constructor(private record: PinRecord, centre: Point, private readonly deps: PinWindowDeps) {
    this.centre = centre
    if (record.state === 'resident') this.win = this.makeWindow()
    else this.shell = new PinShell(record, centre, deps.diameter)
  }

  private makeWindow(): PinWindow {
    return new PinWindow(this.record, this.centre, this.deps)
  }

  get centrePoint(): Point { return this.win && !this.win.isDestroyed() ? this.win.centrePoint : this.centre }
  /** The real pin window, if there is one now. */
  windowIfAny(): PinWindow | null { return this.win && !this.win.isDestroyed() ? this.win : null }
  /** For tests and for promotion: make sure the real pin window exists. */
  ensureWindow(): PinWindow {
    if (!this.win || this.win.isDestroyed()) {
      this.centre = this.shell?.centrePoint ?? this.centre
      this.win = this.makeWindow()
      if (this.lastCountdown) this.win.setCountdown(this.lastCountdown)
      if (this.shown) this.win.show()
      // Keep the bare shell on screen until the window has drawn, so the pin never blinks.
      this.win.onReady(() => { this.shell?.destroy(); this.shell = null })
    }
    return this.win
  }
  hasWindow(): boolean { return !!this.windowIfAny() }
  hasShell(): boolean { return !!this.shell && !this.shell.isDestroyed() }

  show(): void {
    this.shown = true
    this.win?.show()
    this.shell?.show()
  }

  update(record: PinRecord): void {
    this.record = record
    if (record.state === 'resident') this.ensureWindow().update(record)
    else if (this.win) this.win.update(record)
    this.shell?.update(record)
  }

  moveTo(centre: Point): void {
    this.centre = centre
    this.win?.moveTo(centre)
    this.shell?.moveTo(centre)
  }

  setCountdown(countdown: PinView['countdown']): void {
    this.lastCountdown = countdown
    this.win?.setCountdown(countdown)
  }

  /** Called a few times a second with the pointer position: starts or lets go of the pin window of a released pin. */
  poll(cursor: Point, now: number): void {
    if (this.destroyed || this.record.state === 'resident') return
    const window = this.windowIfAny()
    if (!window) {
      const d = this.deps.diameter()
      if (Math.hypot(cursor.x - this.centre.x, cursor.y - this.centre.y) <= d / 2 + NEAR) {
        const created = this.ensureWindow()
        created.hoverNow() // the pointer is already on it: the arming starts at once
      }
      return
    }
    if (!window.isAtRest()) { this.restSince = null; return }
    this.restSince ??= now
    if (now - this.restSince >= DEMOTE_AFTER_MS) this.demote()
  }

  /** The pointer has gone: the real window is closed (its page process ends) and the bare shell shows again. */
  private demote(): void {
    const window = this.win
    if (!window) return
    this.centre = window.centrePoint
    this.restSince = null
    if (!this.shell || this.shell.isDestroyed()) {
      this.shell = new PinShell(this.record, this.centre, this.deps.diameter)
      this.shell.show()
    }
    this.win = null
    window.destroy()
  }

  destroy(): void {
    this.destroyed = true
    this.win?.destroy()
    this.shell?.destroy()
    this.win = null
    this.shell = null
  }
}
