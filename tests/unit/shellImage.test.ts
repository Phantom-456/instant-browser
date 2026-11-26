import { describe, expect, it } from 'vitest'
import { drawShell, shellKey, shellLook, shellScales, SHELL_FALLBACK_DIAMETER, SHELL_PAD } from '../../src/shared/pins/shellImage'
import type { GradientSpec } from '../../src/shared/pins/model'

// A blue to pink pin, like the ones the app makes.
const gradient: GradientSpec = { seed: 1, angle: 135, stops: [{ h: 220, s: 80, l: 55 }, { h: 330, s: 80, l: 60 }] }

/** The four bytes (blue, green, red, alpha) of one pixel. */
const pixel = (img: { width: number; data: Buffer }, x: number, y: number) => {
  const i = (y * img.width + x) * 4
  return { b: img.data[i]!, g: img.data[i + 1]!, r: img.data[i + 2]!, a: img.data[i + 3]! }
}

describe('released pin picture (shell)', () => {
  it('has the size of the old shell: the disc plus a little room, and the dot as before', () => {
    const look = shellLook(30, gradient)
    expect(look.size).toBe(30 + SHELL_PAD * 2)
    expect(look.disc.diameter).toBe(30)
    expect(look.dot.diameter).toBe(11) // round(30 * 0.36)
    expect(shellLook(10, gradient).dot.diameter).toBe(6) // never smaller than 6 points
    expect(look.disc.colour.a).toBeCloseTo(0.34)
    expect(look.dot.colour.a).toBeCloseTo(0.95)
    // the dot is the pink end, the disc the blue end
    expect(look.dot.colour.r).toBeGreaterThan(look.dot.colour.b)
    expect(look.disc.colour.b).toBeGreaterThan(look.disc.colour.r)
  })

  for (const scale of [1, 1.5, 2, 3]) {
    it(`is round at scale ${scale}: every corner pixel is fully transparent, so it can never show as a square`, () => {
      const img = drawShell(shellLook(30, gradient), scale)
      expect(img.width).toBe(Math.round(34 * scale))
      expect(img.data.length).toBe(img.width * img.height * 4)
      const last = img.width - 1
      for (const [x, y] of [[0, 0], [last, 0], [0, last], [last, last]] as const) expect(pixel(img, x, y)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
      // A whole band along the corners (outside the circle) is empty, not just the corner pixel.
      const r = img.width / 2
      let outside = 0
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (Math.hypot(x + 0.5 - r, y + 0.5 - r) > (30 * scale) / 2 + 1) {
            outside++
            expect(pixel(img, x, y).a).toBe(0)
          }
        }
      }
      expect(outside).toBeGreaterThan(img.width * img.width * 0.15) // about 21% of a square lies outside its circle
    })
  }

  it('shows the solid pink dot in the middle and the faint blue disc around it', () => {
    const img = drawShell(shellLook(30, gradient), 2)
    const mid = pixel(img, img.width / 2, img.height / 2)
    expect(mid.a).toBeGreaterThanOrEqual(Math.round(0.95 * 255) - 1)
    expect(mid.r).toBeGreaterThan(mid.b)
    // half way between the dot and the edge of the disc: faint and blue
    const ring = pixel(img, Math.round(img.width / 2 + 11 * 2), img.height / 2)
    expect(ring.a).toBeGreaterThan(70)
    expect(ring.a).toBeLessThan(100) // 0.34 * 255 = 87
    expect(ring.b).toBeGreaterThan(ring.r)
  })

  it('is premultiplied, as nativeImage.createFromBitmap expects: no colour channel is above its alpha', () => {
    const img = drawShell(shellLook(48, gradient), 2)
    for (let i = 0; i < img.data.length; i += 4) {
      const a = img.data[i + 3]!
      expect(Math.max(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!)).toBeLessThanOrEqual(a)
    }
  })

  it('has soft (anti-aliased) edges, not jagged ones', () => {
    const img = drawShell(shellLook(30, gradient), 2)
    const row = img.height / 2
    const alphas = new Set<number>()
    for (let x = 0; x < img.width; x++) alphas.add(pixel(img, x, row).a)
    expect(alphas.size).toBeGreaterThan(3) // 0, the disc, the dot, and steps in between
  })

  it('draws for 1x and 2x always, plus any other screen scale, without duplicates or silly values', () => {
    expect(shellScales([])).toEqual([1, 2])
    expect(shellScales([2, 2, 1])).toEqual([1, 2])
    expect(shellScales([1.5])).toEqual([1, 1.5, 2])
    expect(shellScales([0, -1, Number.NaN, 99])).toEqual([1, 2])
  })

  it('gives the same key for the same look and scales, and a new key when anything that changes the pixels changes', () => {
    const look = shellLook(30, gradient)
    expect(shellKey(look, [1, 2])).toBe(shellKey(shellLook(30, gradient), [1, 2]))
    expect(shellKey(look, [1, 2])).not.toBe(shellKey(shellLook(31, gradient), [1, 2]))
    expect(shellKey(look, [1, 2])).not.toBe(shellKey(look, [1, 1.5, 2]))
    const other: GradientSpec = { ...gradient, stops: [gradient.stops[0]!, { h: 10, s: 80, l: 60 }] }
    expect(shellKey(look, [1, 2])).not.toBe(shellKey(shellLook(30, other), [1, 2]))
  })

  it('never throws on a bad size or a gradient without colours (v8): it draws the usual pin instead', () => {
    for (const d of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      const look = shellLook(d, gradient)
      expect(look.disc.diameter).toBe(SHELL_FALLBACK_DIAMETER)
      expect(() => drawShell(look, 2)).not.toThrow()
    }
    const plain = shellLook(30, { seed: 1, angle: 0, stops: [] })
    expect(plain.dot.colour.r).toBeGreaterThan(plain.dot.colour.b) // the pink end of the usual pin
    expect(() => shellLook(30, undefined as unknown as GradientSpec)).not.toThrow()
  })
})
