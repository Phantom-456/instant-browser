import { BaseWindow, View } from 'electron'
import { hslToRgb } from '../../shared/pins/gradient'
import type { PinRecord, Point } from '../../shared/pins/model'

const PAD = 2 // a little room around the disc

/**
 * The resting look of a pin whose page is released. It is a bare window with two round views and NO web page, so it has
 * no page process at all and costs almost nothing in memory (a few MB, not about 20 MB for a page process).
 * It cannot draw the gradient, the website icon or the capsule. When the pointer comes near, the pin surface starts a
 * real pin window for that (see pinSurface.ts); the shell is back when the pointer has gone.
 *
 * Look: a faint disc of the pin's colour with a solid dot in the middle (dormant), against the filled pin of a live page.
 */
export class PinShell {
  readonly win: BaseWindow
  private readonly disc = new View()
  private readonly dot = new View()
  private destroyed = false

  constructor(private record: PinRecord, private centre: Point, private readonly diameter: () => number) {
    const size = this.size()
    this.win = new BaseWindow({
      x: Math.round(centre.x - size / 2), y: Math.round(centre.y - size / 2), width: size, height: size,
      show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000'
    })
    this.win.setAlwaysOnTop(true, 'floating')
    this.win.setIgnoreMouseEvents(true) // clicks go through; the pointer is watched from outside (see pinSurface.ts)
    this.win.contentView.addChildView(this.disc)
    this.win.contentView.addChildView(this.dot)
    this.paint()
    this.win.setVisibleOnAllWorkspaces(record.following, { visibleOnFullScreen: true })
  }

  private size(): number { return this.diameter() + PAD * 2 }

  private paint(): void {
    const d = this.diameter()
    const s = this.size()
    const stop = this.record.gradient.stops[0]!
    const [r, g, b] = hslToRgb(stop.h, stop.s, stop.l)
    const last = this.record.gradient.stops[this.record.gradient.stops.length - 1]!
    const [r2, g2, b2] = hslToRgb(last.h, last.s, last.l) // the blue end for the disc, the pink end for the dot
    this.disc.setBounds({ x: PAD, y: PAD, width: d, height: d })
    this.disc.setBorderRadius(Math.round(d / 2))
    this.disc.setBackgroundColor(`rgba(${r}, ${g}, ${b}, 0.34)`)
    const dot = Math.max(6, Math.round(d * 0.36))
    this.dot.setBounds({ x: Math.round((s - dot) / 2), y: Math.round((s - dot) / 2), width: dot, height: dot })
    this.dot.setBorderRadius(Math.round(dot / 2))
    this.dot.setBackgroundColor(`rgba(${r2}, ${g2}, ${b2}, 0.95)`)
  }

  get centrePoint(): Point { return this.centre }
  isDestroyed(): boolean { return this.destroyed || this.win.isDestroyed() }
  show(): void { if (!this.isDestroyed()) this.win.showInactive() }
  hide(): void { if (!this.isDestroyed()) this.win.hide() }

  update(record: PinRecord): void {
    this.record = record
    if (this.isDestroyed()) return
    this.win.setVisibleOnAllWorkspaces(record.following, { visibleOnFullScreen: true })
    this.paint()
    this.moveTo(this.centre)
  }

  moveTo(centre: Point): void {
    this.centre = centre
    if (this.isDestroyed()) return
    const size = this.size()
    this.win.setBounds({ x: Math.round(centre.x - size / 2), y: Math.round(centre.y - size / 2), width: size, height: size })
  }

  destroy(): void {
    this.destroyed = true
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}
