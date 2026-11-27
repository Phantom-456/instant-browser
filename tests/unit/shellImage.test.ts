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
  it('has the size of the old shell (the disc plus a little room), a thin ring and room for an icon', () => {
    const look = shellLook(30, gradient)
    expect(look.size).toBe(30 + SHELL_PAD * 2)
    expect(look.disc.diameter).toBe(30)
    expect(look.ring.width).toBeGreaterThanOrEqual(1.5)
    expect(look.icon.diameter).toBe(Math.round(30 * 0.56))
    // the ring runs from the blue end to the pink end; the accent (for the pin glyph) is the blue end, as on a live pin
    expect(look.ring.from.b).toBeGreaterThan(look.ring.from.r)
    expect(look.ring.to.r).toBeGreaterThan(look.ring.to.b)
    expect(look.accent).toEqual({ ...look.ring.from, a: 1 })
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

  it('is no longer a pink dot: without an icon the middle is only a faint fill, and the ring is the gradient', () => {
    const img = drawShell(shellLook(30, gradient), 2)
    const mid = pixel(img, img.width / 2, img.height / 2)
    expect(mid.a).toBeGreaterThan(0)
    expect(mid.a).toBeLessThan(60) // faint, so it never reads as a coloured dot
    // the ring, on the left and on the right of the circle: solid, blue on one side and pink on the other (135 degrees)
    const y = img.height / 2
    const ringAt = (side: -1 | 1) => pixel(img, Math.round(img.width / 2 + side * (15 * 2 - look2.ring.width)), y)
    const look2 = shellLook(30, gradient)
    const left = ringAt(-1), right = ringAt(1)
    expect(left.a).toBeGreaterThan(200)
    expect(right.a).toBeGreaterThan(200)
    expect(left.b - left.r).toBeGreaterThan(right.b - right.r) // bluer on the left, pinker on the right
  })

  const square = (size: number, bgra: [number, number, number, number]) => {
    const data = Buffer.alloc(size * size * 4)
    for (let i = 0; i < data.length; i += 4) data.set(bgra, i)
    return { width: size, height: size, data }
  }

  it('shows the website icon in the middle when there is one', () => {
    const red = square(16, [0, 0, 255, 255]) // premultiplied blue, green, red, alpha: solid red
    const img = drawShell(shellLook(30, gradient), 2, red)
    const mid = pixel(img, img.width / 2, img.height / 2)
    expect(mid).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    // the icon stays inside its square (56% of the pin): just outside it, only the faint fill
    const beside = pixel(img, Math.round(img.width / 2 + (30 * 0.56 * 2) / 2 + 3), img.height / 2)
    expect(beside.a).toBeLessThan(60)
  })

  it('falls back to the pin glyph, drawn in the accent colour (a mask: only its alpha is used)', () => {
    const white = square(8, [255, 255, 255, 255])
    const look = shellLook(30, gradient)
    const img = drawShell(look, 2, { ...white, mask: true })
    const mid = pixel(img, img.width / 2, img.height / 2)
    expect(mid.a).toBe(255)
    expect(Math.abs(mid.r - Math.round(look.accent.r))).toBeLessThanOrEqual(1)
    expect(Math.abs(mid.b - Math.round(look.accent.b))).toBeLessThanOrEqual(1)
  })

  it('never throws on an empty or odd icon: it is left out', () => {
    for (const bad of [{ width: 0, height: 0, data: Buffer.alloc(0) }, { width: 4, height: 4, data: Buffer.alloc(3) }]) {
      expect(() => drawShell(shellLook(30, gradient), 2, bad)).not.toThrow()
    }
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
    expect(alphas.size).toBeGreaterThan(3) // 0, the fill, the ring, and steps in between
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
    expect(shellKey(look, [1, 2], 'icon-a')).not.toBe(shellKey(look, [1, 2], 'icon-b')) // another icon, another picture
  })

  it('never throws on a bad size or a gradient without colours (v8): it draws the usual pin instead', () => {
    for (const d of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      const look = shellLook(d, gradient)
      expect(look.disc.diameter).toBe(SHELL_FALLBACK_DIAMETER)
      expect(() => drawShell(look, 2)).not.toThrow()
    }
    const plain = shellLook(30, { seed: 1, angle: 0, stops: [] })
    expect(plain.ring.to.r).toBeGreaterThan(plain.ring.to.b) // the pink end of the usual pin
    expect(() => shellLook(30, undefined as unknown as GradientSpec)).not.toThrow()
  })
})
