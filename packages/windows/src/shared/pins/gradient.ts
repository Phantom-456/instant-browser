import type { GradientSpec, GradientStop } from './model'

/**
 * Each pin gets its own colours, made from a random seed when the pin is created (not picked from a fixed list).
 * The rules: a random hue, controlled saturation and lightness, two or three harmonious stops, a hue far from the
 * hues already in use, and colours that stay readable on a light and on a dark desktop. After many pins the
 * colours cannot all be far apart, so the pin also shows a name (and later an icon) next to its colour.
 */

/** A small, fast random number generator. The same seed always gives the same numbers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- Colour maths (WCAG relative luminance and contrast) ----

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360
  const sat = Math.min(Math.max(s, 0), 100) / 100
  const light = Math.min(Math.max(l, 0), 100) / 100
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
  const p = 2 * light - q
  const channel = (t0: number): number => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [Math.round(channel(hue + 1 / 3) * 255), Math.round(channel(hue) * 255), Math.round(channel(hue - 1 / 3) * 255)]
}

export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(l1: number, l2: number): number {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE = 1
const NEAR_BLACK = luminance([18, 18, 22])

/** How far apart two hues are, 0 to 180 degrees. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

/** Is this stop a good border or fill colour on both a light and a dark desktop (at least 3 to 1 against each)? */
export function stopIsVisible(stop: GradientStop): boolean {
  const y = luminance(hslToRgb(stop.h, stop.s, stop.l))
  return contrast(y, WHITE) >= 3 && contrast(y, NEAR_BLACK) >= 3
}

/** Black or white text: whichever is readable (at least 4.5 to 1) on a background of the given luminance. */
export function readableText(backgroundLuminance: number): 'black' | 'white' {
  return contrast(backgroundLuminance, 0) >= contrast(backgroundLuminance, 1) ? 'black' : 'white'
}

// ---- The gradient ----

/**
 * Every pin uses the same blue to pink gradient, like the one in Arc's own look: a bright blue, a violet and a pink. (An earlier
 * version made a different random gradient for each pin; the user chose one look for all.) All three colours pass the
 * contrast rule: they stay visible on a light and on a dark desktop.
 */
export const ARC_STOPS: GradientStop[] = [
  { h: 224, s: 90, l: 60 }, // blue
  { h: 268, s: 80, l: 64 }, // violet
  { h: 334, s: 88, l: 64 } // pink
]
export const ARC_ANGLE = 135

/** The gradient of a pin. `seed` is kept (it identifies the pin's gradient record) but does not change the colours. */
export function arcGradient(seed = 0): GradientSpec {
  return { seed: seed >>> 0, stops: ARC_STOPS.map((s) => ({ ...s })), angle: ARC_ANGLE }
}

/** Kept for the callers that ask for a new pin's gradient: it is always the blue to pink one. */
export function generateGradient(_existing: GradientSpec[] = [], seed = 0): GradientSpec {
  return arcGradient(seed)
}

export function stopCss(stop: GradientStop): string {
  return `hsl(${stop.h} ${stop.s}% ${stop.l}%)`
}

/** For the pin's border, fill and accents. */
export function gradientCss(spec: GradientSpec): string {
  return `linear-gradient(${spec.angle}deg, ${spec.stops.map(stopCss).join(', ')})`
}
