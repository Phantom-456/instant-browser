import { app, BaseWindow, ImageView, View, nativeImage, powerMonitor, screen, type NativeImage } from 'electron'
import { join } from 'node:path'
import type { PinRecord, Point } from '../../shared/pins/model'
import { drawShell, shellKey, shellLook, shellScales, SHELL_PAD, type ShellIcon } from '../../shared/pins/shellImage'

/**
 * The icon in the middle of a released pin: the website's own icon when Electron can decode it (PNG, JPEG, ICO), or
 * else the pin glyph (resources/pin-glyph.png, white, used as a mask in the pin's accent colour). Electron cannot
 * decode SVG here (no page), so an SVG site icon falls back to the pin glyph too (user, 2026-11-27).
 */
type IconChoice = { icon: ShellIcon | undefined; key: string; source: 'site' | 'glyph' | 'none' }
let glyph: ShellIcon | null | undefined
function pinGlyph(): ShellIcon | null {
  if (glyph !== undefined) return glyph
  try {
    const img = nativeImage.createFromPath(join(app.getAppPath(), 'resources/pin-glyph.png'))
    const { width, height } = img.getSize()
    glyph = img.isEmpty() ? null : { width, height, data: img.toBitmap(), mask: true }
  } catch { glyph = null }
  return glyph
}
const siteIcons = new Map<string, ShellIcon | null>() // by the icon's data URL; a few at most
function siteIcon(dataUrl: string): ShellIcon | null {
  if (siteIcons.has(dataUrl)) return siteIcons.get(dataUrl)!
  let icon: ShellIcon | null = null
  try {
    let img = nativeImage.createFromDataURL(dataUrl)
    if (!img.isEmpty()) {
      const { width, height } = img.getSize()
      if (Math.max(width, height) > 128) img = img.resize({ width: 128, height: 128, quality: 'best' })
      const size = img.getSize()
      if (size.width > 0 && size.height > 0) icon = { width: size.width, height: size.height, data: img.toBitmap() }
    }
  } catch { icon = null }
  if (siteIcons.size > 32) siteIcons.clear()
  siteIcons.set(dataUrl, icon)
  return icon
}
function iconFor(record: PinRecord): IconChoice {
  const site = record.icon ? siteIcon(record.icon) : null
  if (site) return { icon: site, key: `site:${record.icon!.length}:${record.icon!.slice(-48)}`, source: 'site' }
  const g = pinGlyph()
  return g ? { icon: g, key: 'glyph', source: 'glyph' } : { icon: undefined, key: '', source: 'none' }
}

/** How often every released pin is drawn again, just in case (one timer for all pins, not one each). */
const HEAL_MS = Number(process.env.INSTANT_TEST_SHELL_HEAL_MS ?? 30_000)

/** The released pins that exist now. The system events below are listened to ONCE for all of them. */
const shells = new Set<PinShell>()
let heal: NodeJS.Timeout | null = null
const refreshAll = (): void => { for (const s of shells) s.refresh() }

function watch(shell: PinShell): void {
  shells.add(shell)
  if (shells.size > 1) return
  // The system can redraw or rebuild a window when the screen wakes up, the Mac is unlocked, or a display changes.
  powerMonitor.on('resume', refreshAll)
  powerMonitor.on('unlock-screen', refreshAll)
  screen.on('display-metrics-changed', refreshAll)
  screen.on('display-added', refreshAll)
  screen.on('display-removed', refreshAll)
  heal = setInterval(refreshAll, HEAL_MS)
  heal.unref?.()
}

function unwatch(shell: PinShell): void {
  if (!shells.delete(shell) || shells.size > 0) return
  powerMonitor.removeListener('resume', refreshAll)
  powerMonitor.removeListener('unlock-screen', refreshAll)
  screen.removeListener('display-metrics-changed', refreshAll)
  screen.removeListener('display-added', refreshAll)
  screen.removeListener('display-removed', refreshAll)
  if (heal) clearInterval(heal)
  heal = null
}

/**
 * Pictures already drawn, shared by ALL released pins. Every pin has the same colours, so pins of one size show the
 * same pixels: twenty released pins draw the picture once, not twenty times. Kept small (newest last).
 */
const PICTURES_KEPT = 8
const pictures = new Map<string, NativeImage>()
let pictureDraws = 0

function sharedPicture(key: string, draw: () => NativeImage): NativeImage {
  const hit = pictures.get(key)
  if (hit) {
    pictures.delete(key) // move to the newest end
    pictures.set(key, hit)
    return hit
  }
  const img = draw()
  pictureDraws++
  pictures.set(key, img)
  while (pictures.size > PICTURES_KEPT) pictures.delete(pictures.keys().next().value!)
  return img
}

/** ImageView is marked experimental in Electron. If it is ever missing, the shell falls back to two rounded views. */
const canDrawPicture = typeof ImageView === 'function'

/**
 * The resting look of a pin whose page is released. It is a bare window with NO web page, so it has no page process at
 * all and costs almost nothing in memory (a few MB, not about 20 MB for a page process).
 * It cannot draw the gradient, the website icon or the capsule. When the pointer comes near, the pin surface starts a
 * real pin window for that (see pinSurface.ts); the shell is back when the pointer has gone.
 *
 * Look: a faint disc of the pin's colour with a solid dot in the middle (dormant), against the filled pin of a live page.
 *
 * It is drawn as ONE picture with transparent corners (see shared/pins/shellImage.ts), not as views made round with a
 * corner radius: macOS could drop that rounding and the pin then showed as a solid square.
 */
export class PinShell {
  readonly win: BaseWindow
  private readonly picture: ImageView | null = canDrawPicture ? new ImageView() : null
  private readonly disc: View | null = canDrawPicture ? null : new View()
  private readonly dot: View | null = canDrawPicture ? null : new View()
  private destroyed = false
  private paints = 0
  private draws = 0
  private iconSource: IconChoice['source'] = 'none'
  private cached: { key: string; img: NativeImage } | null = null
  /** The one extra redraw just after show(); cleared when the pin goes, so no timer outlives it. */
  private later: NodeJS.Timeout | null = null

  constructor(private record: PinRecord, private centre: Point, private readonly diameter: () => number) {
    const size = this.size()
    this.win = new BaseWindow({
      x: Math.round(centre.x - size / 2), y: Math.round(centre.y - size / 2), width: size, height: size,
      show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000'
    })
    this.win.setAlwaysOnTop(true, 'floating')
    this.win.setIgnoreMouseEvents(true) // clicks go through; the pointer is watched from outside (see pinSurface.ts)
    for (const v of [this.picture, this.disc, this.dot]) if (v) this.win.contentView.addChildView(v)
    this.paint()
    this.win.setVisibleOnAllWorkspaces(record.following, { visibleOnFullScreen: true })
    watch(this)
  }

  private size(): number { return this.diameter() + SHELL_PAD * 2 }

  /** The picture of this pin, drawn for normal and Retina screens (and any other scale a connected screen uses). */
  private image(): NativeImage {
    const look = shellLook(this.diameter(), this.record.gradient)
    const choice = iconFor(this.record)
    this.iconSource = choice.source
    let scales = [1, 2]
    try { scales = shellScales(screen.getAllDisplays().map((d) => d.scaleFactor)) } catch { /* no screen module yet: 1 and 2 */ }
    const key = shellKey(look, scales, choice.key)
    if (this.cached?.key === key) return this.cached.img // the same look: nothing new to show
    const img = sharedPicture(key, () => {
      let made: NativeImage | null = null
      for (const scaleFactor of scales) {
        const { width, height, data } = drawShell(look, scaleFactor, choice.icon)
        if (!made) made = nativeImage.createFromBitmap(data, { width, height, scaleFactor })
        else made.addRepresentation({ scaleFactor, width, height, buffer: data })
      }
      return made!
    })
    this.draws++
    this.cached = { key, img }
    return img
  }

  private paint(): void {
    this.paints++
    const s = this.size()
    if (this.picture) {
      this.picture.setBounds({ x: 0, y: 0, width: s, height: s })
      this.picture.setImage(this.image())
      return
    }
    // Fallback (no ImageView): two views made round with a corner radius.
    const look = shellLook(this.diameter(), this.record.gradient)
    const css = (c: { r: number; g: number; b: number; a: number }) => `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`
    const d = look.disc.diameter
    this.disc!.setBounds({ x: SHELL_PAD, y: SHELL_PAD, width: d, height: d })
    this.disc!.setBorderRadius(Math.round(d / 2))
    this.disc!.setBackgroundColor(css(look.disc.colour))
    const dot = look.dot.diameter
    this.dot!.setBounds({ x: Math.round((s - dot) / 2), y: Math.round((s - dot) / 2), width: dot, height: dot })
    this.dot!.setBorderRadius(Math.round(dot / 2))
    this.dot!.setBackgroundColor(css({ ...look.accent, a: 0.6 })) // the accent, not the pink end: no pink dot
  }

  /** Make the pin look right again: no window colour behind it, and the pin drawn once more. Cheap; safe to call often. */
  refresh(): void {
    if (this.isDestroyed()) return
    this.win.setBackgroundColor('#00000000')
    this.paint()
  }

  get centrePoint(): Point { return this.centre }
  isDestroyed(): boolean { return this.destroyed || this.win.isDestroyed() }
  show(): void {
    if (this.isDestroyed()) return
    this.win.showInactive()
    this.refresh()
    if (this.later) clearTimeout(this.later) // showing again soon after: one pending redraw is enough
    this.later = setTimeout(() => { this.later = null; this.refresh() }, 60) // once more when the window is really on screen
  }
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

  /** For tests: how the shell is drawn now. */
  debug(): { mode: 'picture' | 'views'; views: number; paints: number; draws: number; icon: IconChoice['source']; imageSize: { width: number; height: number } | null; windowSize: { width: number; height: number } } {
    const b = this.isDestroyed() ? { width: 0, height: 0 } : this.win.getBounds()
    return {
      windowSize: { width: b.width, height: b.height },
      mode: this.picture ? 'picture' : 'views',
      views: this.isDestroyed() ? 0 : this.win.contentView.children.length,
      paints: this.paints,
      draws: this.draws,
      icon: this.iconSource,
      imageSize: this.cached ? this.cached.img.getSize() : null
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.later) clearTimeout(this.later)
    this.later = null
    unwatch(this)
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}

/** For tests: how many released pins are being looked after, and how many system listeners that takes. */
export function shellWatch(): { shells: number; resumeListeners: number; displayListeners: number; pictures: number; pictureDraws: number } {
  return {
    shells: shells.size,
    pictures: pictures.size,
    pictureDraws,
    resumeListeners: powerMonitor.listenerCount('resume'),
    displayListeners: screen.listenerCount('display-metrics-changed')
  }
}

/** For tests: draw every released pin again now, as after a wake-up. */
export function refreshAllShells(): void { refreshAll() }
