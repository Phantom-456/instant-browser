import { ARC_ANGLE, ARC_STOPS, hslToRgb } from './gradient'
import type { GradientSpec } from './model'

/**
 * The picture of a released pin (the "shell"): a thin ring in the pin's gradient, a very faint fill, and an icon in the
 * middle: the website's own icon, or the pin glyph in the pin's accent colour when the site has none that can be drawn.
 * It looks like a released live pin (border only, the icon on top), not like a coloured dot.
 *
 * Why a picture: the shell used to be two square views made round with a corner radius. macOS can drop that rounding
 * (a new window, the screen waking up, a display change), and the pin then showed as a solid square. A picture whose
 * corners are transparent pixels has nothing that can be dropped: the round shape is in the pixels themselves.
 * The earlier picture (a faint disc with a solid pink dot) read as a pink or red circle (user, 2026-11-27).
 *
 * Plain maths only (no Electron), so it can be tested without a window.
 */

/** A colour with its opacity (r, g, b from 0 to 255, a from 0 to 1). */
export type Rgba = { r: number; g: number; b: number; a: number }

export interface ShellLook {
  /** Width and height of the shell window, in points. */
  size: number
  /** The pin's circle and its faint fill. */
  disc: { diameter: number; colour: Rgba }
  /** Only for the fallback without ImageView (two plain views): a small dot in the middle. */
  dot: { diameter: number; colour: Rgba }
  /** The border: from the first colour to the last, along the pin's angle (CSS degrees). Width in points. */
  ring: { width: number; from: Rgba; to: Rgba; angle: number }
  /** The colour of the pin glyph (the first colour, as the icon of a released live pin). */
  accent: Rgba
  /** The square the icon is drawn in, in points. */
  icon: { diameter: number }
}

/**
 * An icon to draw in the middle: pixels in Electron's bitmap order (blue, green, red, alpha, colour already multiplied
 * by alpha), as nativeImage.toBitmap gives them. With mask, only the alpha is used and the colour is the accent.
 */
export interface ShellIcon { width: number; height: number; data: Buffer; mask?: boolean }

/** A little room around the disc, in points. */
export const SHELL_PAD = 2

/** The size used when the pin size given is not a usable number (the default pin size in settings). */
export const SHELL_FALLBACK_DIAMETER = 28

/** The look of a released pin of this diameter and these colours. */
export function shellLook(diameter: number, gradient: GradientSpec): ShellLook {
  // Never throw here: this runs while a window is made in the main process. A size that is not a number, or a
  // gradient without colours, gives the usual pin (default size, blue to pink) instead of a crash.
  if (!Number.isFinite(diameter) || diameter <= 0) diameter = SHELL_FALLBACK_DIAMETER
  const stops = gradient?.stops?.length ? gradient.stops : ARC_STOPS
  const angle = Number.isFinite(gradient?.angle) ? gradient.angle : ARC_ANGLE
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  const [r, g, b] = hslToRgb(first.h, first.s, first.l)
  const [r2, g2, b2] = hslToRgb(last.h, last.s, last.l)
  return {
    size: diameter + SHELL_PAD * 2,
    disc: { diameter, colour: { r, g, b, a: 0.14 } },
    dot: { diameter: Math.max(6, Math.round(diameter * 0.36)), colour: { r: r2, g: g2, b: b2, a: 0.95 } },
    ring: { width: Math.max(1.5, Math.round(diameter * 0.07 * 2) / 2), from: { r, g, b, a: 0.95 }, to: { r: r2, g: g2, b: b2, a: 0.95 }, angle },
    accent: { r, g, b, a: 1 },
    icon: { diameter: Math.round(diameter * 0.56) }
  }
}

/** How much of a pixel (0 to 1) a circle of this radius covers, for a pixel whose centre is this far from the circle's centre. */
function coverage(distance: number, radius: number): number {
  return Math.min(1, Math.max(0, radius - distance + 0.5)) // a one-pixel soft edge, so the circle is not jagged
}

/** The icon's premultiplied colour and alpha (0 to 1) at a point inside it (u, v from 0 to 1), smoothly between pixels. */
function sampleIcon(icon: ShellIcon, u: number, v: number): [number, number, number, number] {
  const fx = Math.min(icon.width - 1, Math.max(0, u * icon.width - 0.5))
  const fy = Math.min(icon.height - 1, Math.max(0, v * icon.height - 0.5))
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const x1 = Math.min(icon.width - 1, x0 + 1), y1 = Math.min(icon.height - 1, y0 + 1)
  const tx = fx - x0, ty = fy - y0
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (const [x, y, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]] as const) {
    const i = (y * icon.width + x) * 4
    for (let c = 0; c < 4; c++) out[c]! += (icon.data[i + c]! / 255) * w
  }
  return out // blue, green, red, alpha
}

const usable = (icon?: ShellIcon): icon is ShellIcon =>
  !!icon && icon.width > 0 && icon.height > 0 && icon.data.length >= icon.width * icon.height * 4

/**
 * Draw the shell at this scale (1 for a normal screen, 2 for Retina). The result is what Electron's
 * nativeImage.createFromBitmap expects: 4 bytes a pixel in the order blue, green, red, alpha, with the colour already
 * multiplied by the alpha. Everything outside the circle is fully transparent (all four bytes 0).
 */
export function drawShell(look: ShellLook, scale: number, icon?: ShellIcon): { width: number; height: number; data: Buffer } {
  const px = Math.max(1, Math.round(look.size * scale))
  const data = Buffer.alloc(px * px * 4)
  const centre = px / 2
  const outerR = (look.disc.diameter * scale) / 2
  const innerR = outerR - look.ring.width * scale
  const { disc, ring, accent } = look
  // The gradient runs along the CSS angle: 0 is upwards, 90 to the right, 135 to the bottom right.
  const rad = (ring.angle * Math.PI) / 180
  const dx = Math.sin(rad), dy = -Math.cos(rad)
  const side = look.icon.diameter * scale
  const iconLeft = centre - side / 2
  const drawIcon = usable(icon)
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const cx = x + 0.5 - centre, cy = y + 0.5 - centre
      const d = Math.hypot(cx, cy)
      const inside = coverage(d, outerR)
      if (inside <= 0) continue
      // Premultiplied colour (0 to 255) and alpha (0 to 1), built from the bottom up with "source over".
      let a = disc.colour.a * inside
      let r = disc.colour.r * a, g = disc.colour.g * a, b = disc.colour.b * a
      const over = (sr: number, sg: number, sb: number, sa: number): void => {
        r = sr + r * (1 - sa); g = sg + g * (1 - sa); b = sb + b * (1 - sa); a = sa + a * (1 - sa)
      }
      const ringA = Math.max(0, inside - coverage(d, innerR))
      if (ringA > 0) {
        const t = Math.min(1, Math.max(0, (cx * dx + cy * dy) / (2 * outerR) + 0.5))
        const ra = (ring.from.a + (ring.to.a - ring.from.a) * t) * ringA
        over((ring.from.r + (ring.to.r - ring.from.r) * t) * ra, (ring.from.g + (ring.to.g - ring.from.g) * t) * ra, (ring.from.b + (ring.to.b - ring.from.b) * t) * ra, ra)
      }
      if (drawIcon && x + 0.5 >= iconLeft && x + 0.5 <= iconLeft + side && y + 0.5 >= iconLeft && y + 0.5 <= iconLeft + side) {
        const [ib, ig, ir, ia] = sampleIcon(icon, (x + 0.5 - iconLeft) / side, (y + 0.5 - iconLeft) / side)
        if (ia > 0) {
          if (icon.mask) over(accent.r * ia, accent.g * ia, accent.b * ia, ia)
          else over(ir * 255, ig * 255, ib * 255, ia)
        }
      }
      if (a <= 0) continue
      const i = (y * px + x) * 4
      const alpha = Math.min(255, Math.round(a * 255))
      // Premultiplied: each colour channel is never more than alpha.
      data[i] = Math.min(alpha, Math.round(b))
      data[i + 1] = Math.min(alpha, Math.round(g))
      data[i + 2] = Math.min(alpha, Math.round(r))
      data[i + 3] = alpha
    }
  }
  return { width: px, height: px, data }
}

/** The scales to draw for: always 1 and 2, plus the scale of any screen that uses another one (for example 1.5). */
export function shellScales(screenScales: number[]): number[] {
  const all = new Set<number>([1, 2])
  for (const s of screenScales) if (Number.isFinite(s) && s > 0 && s <= 4) all.add(Math.round(s * 100) / 100)
  return [...all].sort((a, b) => a - b)
}

/** A short text that is the same exactly when the picture would be the same (so a drawn picture can be reused). */
export function shellKey(look: ShellLook, scales: number[], iconKey = ''): string {
  const c = (x: Rgba) => `${x.r},${x.g},${x.b},${x.a}`
  return `${look.size}|${look.disc.diameter}|${c(look.disc.colour)}|${look.ring.width}|${c(look.ring.from)}|${c(look.ring.to)}|${look.ring.angle}|${look.icon.diameter}|${scales.join(',')}|${iconKey}`
}
