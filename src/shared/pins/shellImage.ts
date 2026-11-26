import { ARC_STOPS, hslToRgb } from './gradient'
import type { GradientSpec } from './model'

/**
 * The picture of a released pin (the "shell"): a faint disc of the pin's first colour with a solid dot of its last colour.
 *
 * Why a picture: the shell used to be two square views made round with a corner radius. macOS can drop that rounding
 * (a new window, the screen waking up, a display change), and the pin then showed as a solid square. A picture whose
 * corners are transparent pixels has nothing that can be dropped: the round shape is in the pixels themselves.
 *
 * Plain maths only (no Electron), so it can be tested without a window.
 */

/** A colour with its opacity (r, g, b from 0 to 255, a from 0 to 1). */
export type Rgba = { r: number; g: number; b: number; a: number }

export interface ShellLook {
  /** Width and height of the shell window, in points. */
  size: number
  disc: { diameter: number; colour: Rgba }
  dot: { diameter: number; colour: Rgba }
}

/** A little room around the disc, in points. */
export const SHELL_PAD = 2

/** The size used when the pin size given is not a usable number (the default pin size in settings). */
export const SHELL_FALLBACK_DIAMETER = 28

/** The look of a released pin of this diameter and these colours: the blue end for the disc, the pink end for the dot. */
export function shellLook(diameter: number, gradient: GradientSpec): ShellLook {
  // Never throw here: this runs while a window is made in the main process. A size that is not a number, or a
  // gradient without colours, gives the usual pin (default size, blue to pink) instead of a crash.
  if (!Number.isFinite(diameter) || diameter <= 0) diameter = SHELL_FALLBACK_DIAMETER
  const stops = gradient?.stops?.length ? gradient.stops : ARC_STOPS
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  const [r, g, b] = hslToRgb(first.h, first.s, first.l)
  const [r2, g2, b2] = hslToRgb(last.h, last.s, last.l)
  return {
    size: diameter + SHELL_PAD * 2,
    disc: { diameter, colour: { r, g, b, a: 0.34 } },
    dot: { diameter: Math.max(6, Math.round(diameter * 0.36)), colour: { r: r2, g: g2, b: b2, a: 0.95 } }
  }
}

/** How much of a pixel (0 to 1) a circle of this radius covers, for a pixel whose centre is this far from the circle's centre. */
function coverage(distance: number, radius: number): number {
  return Math.min(1, Math.max(0, radius - distance + 0.5)) // a one-pixel soft edge, so the circle is not jagged
}

/**
 * Draw the shell at this scale (1 for a normal screen, 2 for Retina). The result is what Electron's
 * nativeImage.createFromBitmap expects: 4 bytes a pixel in the order blue, green, red, alpha, with the colour already
 * multiplied by the alpha. Everything outside the disc is fully transparent (all four bytes 0).
 */
export function drawShell(look: ShellLook, scale: number): { width: number; height: number; data: Buffer } {
  const px = Math.max(1, Math.round(look.size * scale))
  const data = Buffer.alloc(px * px * 4)
  const centre = px / 2
  const discR = (look.disc.diameter * scale) / 2
  const dotR = (look.dot.diameter * scale) / 2
  const { disc, dot } = look
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const d = Math.hypot(x + 0.5 - centre, y + 0.5 - centre)
      // The disc, then the dot over it ("source over", in straight colour).
      const da = disc.colour.a * coverage(d, discR)
      const ta = dot.colour.a * coverage(d, dotR)
      const a = ta + da * (1 - ta)
      if (a <= 0) continue
      const mix = (top: number, under: number): number => (top * ta + under * da * (1 - ta)) / a
      const i = (y * px + x) * 4
      const alpha = Math.round(a * 255)
      // Premultiplied: each colour channel is never more than alpha.
      data[i] = Math.min(alpha, Math.round(mix(dot.colour.b, disc.colour.b) * a))
      data[i + 1] = Math.min(alpha, Math.round(mix(dot.colour.g, disc.colour.g) * a))
      data[i + 2] = Math.min(alpha, Math.round(mix(dot.colour.r, disc.colour.r) * a))
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
export function shellKey(look: ShellLook, scales: number[]): string {
  const c = (x: Rgba) => `${x.r},${x.g},${x.b},${x.a}`
  return `${look.size}|${look.disc.diameter}|${c(look.disc.colour)}|${look.dot.diameter}|${c(look.dot.colour)}|${scales.join(',')}`
}
