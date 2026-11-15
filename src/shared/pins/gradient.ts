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

// ---- Making a gradient ----

const ATTEMPTS = 24
/** A new pin tries to be at least this far (in hue) from every existing pin. It shrinks as pins grow. */
function wantedDistance(existingCount: number): number {
  return Math.max(10, Math.min(60, 360 / (existingCount + 2)))
}

function build(seed: number): GradientSpec {
  const rng = mulberry32(seed)
  const baseHue = rng() * 360
  const saturation = 68 + rng() * 22 // 68 to 90
  const stopCount = rng() < 0.5 ? 2 : 3
  const spread = 22 + rng() * 26 // neighbouring stops are 22 to 48 degrees apart: harmonious
  const direction = rng() < 0.5 ? 1 : -1
  const stops: GradientStop[] = []
  for (let i = 0; i < stopCount; i++) {
    const hue = (baseHue + direction * spread * i + 360) % 360
    // Find a lightness that is visible on both light and dark desktops (mid-tones). Yellows and greens need a darker value.
    let lightness = 50
    for (const candidate of [50, 46, 54, 42, 58, 38, 62, 34]) {
      if (stopIsVisible({ h: hue, s: saturation, l: candidate })) { lightness = candidate; break }
    }
    stops.push({ h: Math.round(hue), s: Math.round(saturation), l: lightness })
  }
  return { seed, stops, angle: Math.round(rng() * 360) }
}

/**
 * Make a gradient for a new pin. Tries a bounded number of seeds, keeps the first one that is far enough from the
 * existing pins, and otherwise the best one found. `seed` lets a test (or a retry) ask for a repeatable result.
 */
export function generateGradient(existing: GradientSpec[], seed = (Math.random() * 4294967296) >>> 0): GradientSpec {
  const wanted = wantedDistance(existing.length)
  const usedHues = existing.map((g) => g.stops[0]?.h ?? 0)
  let best: { spec: GradientSpec; distance: number } | null = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const spec = build((seed + attempt * 2654435761) >>> 0)
    const distance = usedHues.length === 0 ? 180 : Math.min(...usedHues.map((h) => hueDistance(h, spec.stops[0]!.h)))
    if (!spec.stops.every(stopIsVisible)) continue
    if (distance >= wanted) return spec
    if (!best || distance > best.distance) best = { spec, distance }
  }
  return best?.spec ?? build(seed)
}

export function stopCss(stop: GradientStop): string {
  return `hsl(${stop.h} ${stop.s}% ${stop.l}%)`
}

/** For the pin's border, fill and accents. */
export function gradientCss(spec: GradientSpec): string {
  return `linear-gradient(${spec.angle}deg, ${spec.stops.map(stopCss).join(', ')})`
}
