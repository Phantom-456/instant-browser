import { describe, expect, it } from 'vitest'
import { ARM_MS, GRACE_MS, IDLE, armProgress, isOpen, nextTickAt, stepArming, takesClicks, type ArmState } from '../../src/shared/pins/arming'
import { armedLayout, chooseSide, contains, freeSpot, onCircle, restingBounds, SHADOW_MARGIN } from '../../src/shared/pins/geometry'
import type { Rect } from '../../src/shared/pins/model'

const screen: Rect = { x: 0, y: 25, width: 1440, height: 800 }
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height

describe('pin layout', () => {
  it('wraps the circle in a capsule that grows to the left; Follow right, Offload below, Remove above', () => {
    const l = armedLayout({ x: 700, y: 400 }, 30, screen)
    expect(l.descriptionSide).toBe('left')
    const pill = l.description
    // the capsule encloses the circle, on the circle's side (the right end)
    expect(inside(l.circle, pill)).toBe(true)
    expect(pill.x + pill.width - (l.circle.x + l.circle.width)).toBeLessThan(10)
    expect(pill.x).toBeLessThan(l.circle.x - 100) // and the room for the name is on the other side
    expect(l.follow.x).toBeGreaterThanOrEqual(pill.x + pill.width)
    expect(l.offload.y).toBeGreaterThanOrEqual(pill.y + pill.height)
    expect(l.remove.y + l.remove.height).toBeLessThanOrEqual(pill.y)
  })

  it('keeps the circle where it was when there is room', () => {
    const l = armedLayout({ x: 700, y: 400 }, 48, screen)
    expect(l.circleCentre).toEqual({ x: 700, y: 400 })
  })

  it('mirrors at the left edge', () => {
    const c = { x: 40, y: 400 }
    expect(chooseSide(c, 48, screen)).toBe('right')
    const l = armedLayout(c, 48, screen)
    expect(l.descriptionSide).toBe('right')
    expect(l.follow.x + l.follow.width).toBeLessThan(l.circle.x)
  })

  it('stays inside the work area at every edge and corner, for several sizes', () => {
    for (const d of [24, 30, 48, 72]) {
      for (const x of [0, 30, 720, 1410, 1440]) {
        for (const y of [25, 60, 400, 790, 825]) {
          const l = armedLayout({ x, y }, d, screen)
          expect(inside(l.bounds, screen)).toBe(true)
          for (const part of [l.circle, l.description, l.follow, l.offload, l.remove]) {
            expect(inside({ x: part.x + l.bounds.x, y: part.y + l.bounds.y, width: part.width, height: part.height }, l.bounds)).toBe(true)
          }
        }
      }
    }
  })

  it('keeps the bubbles off the capsule and off each other', () => {
    const l = armedLayout({ x: 700, y: 400 }, 30, screen)
    const hit = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    for (const bubble of [l.follow, l.offload, l.remove]) expect(hit(l.description, bubble)).toBe(false)
    expect(hit(l.follow, l.offload)).toBe(false)
    expect(hit(l.offload, l.remove)).toBe(false)
  })

  it('keeps the bubbles big enough to hit on a small pin, and grows with a big pin', () => {
    const small = armedLayout({ x: 700, y: 400 }, 30, screen)
    const big = armedLayout({ x: 700, y: 400 }, 72, screen)
    expect(small.follow.width).toBeGreaterThanOrEqual(26)
    expect(big.follow.width).toBeGreaterThan(small.follow.width)
    expect(big.description.width).toBeGreaterThan(small.description.width)
  })

  it('rests as just the circle and its shadow room', () => {
    const b = restingBounds({ x: 100, y: 100 }, 48)
    expect(b.width).toBe(48 + SHADOW_MARGIN * 2)
    expect(b.x + b.width / 2).toBe(100)
  })

  it('tests the pointer against the circle, not the corner of the window', () => {
    const circle = { x: 10, y: 10, width: 48, height: 48 }
    expect(onCircle(circle, { x: 34, y: 34 })).toBe(true)
    expect(onCircle(circle, { x: 11, y: 11 })).toBe(false) // the square corner, outside the round shape
    expect(contains(circle, { x: 11, y: 11 })).toBe(true)
  })
})

describe('arming', () => {
  const run = (...steps: Array<[Parameters<typeof stepArming>[1], number]>): ArmState => steps.reduce<ArmState>((s, [e, t]) => stepArming(s, e, t), IDLE)

  it('arms only after 2 seconds, and ignores clicks until then', () => {
    let s = run(['enter', 0])
    expect(s.phase).toBe('arming')
    expect(takesClicks(s)).toBe(false)
    s = stepArming(s, 'tick', ARM_MS - 1)
    expect(s.phase).toBe('arming')
    s = stepArming(s, 'tick', ARM_MS)
    expect(s.phase).toBe('armed')
    expect(takesClicks(s)).toBe(true)
  })

  it('goes back to idle when the pointer leaves early', () => {
    expect(run(['enter', 0], ['leave', 1500]).phase).toBe('idle')
  })

  it('waits 200 ms before closing, and stays open if the pointer returns', () => {
    const armed = run(['enter', 0], ['tick', ARM_MS])
    let s = stepArming(armed, 'leave', 3000)
    expect(s.phase).toBe('grace')
    expect(takesClicks(s)).toBe(true)
    s = stepArming(s, 'enter', 3100)
    expect(s.phase).toBe('armed')
    s = stepArming(stepArming(s, 'leave', 4000), 'tick', 4000 + GRACE_MS)
    expect(s.phase).toBe('idle')
    expect(isOpen(s)).toBe(false)
  })

  it('reports progress and the next time to check', () => {
    const s = run(['enter', 1000])
    expect(armProgress(s, 2000)).toBeCloseTo(0.5)
    expect(armProgress(s, 9000)).toBe(1)
    expect(nextTickAt(s)).toBe(1000 + ARM_MS)
    expect(nextTickAt(IDLE)).toBeNull()
    expect(nextTickAt({ phase: 'armed' })).toBeNull()
  })
})

describe('free spot for a new pin', () => {
  it('uses the wanted place when it is free', () => {
    expect(freeSpot({ x: 500, y: 400 }, [{ x: 900, y: 400 }], 48, screen)).toEqual({ x: 500, y: 400 })
  })

  it('moves a new pin off another pin', () => {
    const p = freeSpot({ x: 500, y: 400 }, [{ x: 500, y: 400 }], 48, screen)
    expect(Math.hypot(p.x - 500, p.y - 400)).toBeGreaterThanOrEqual(48 * 1.4)
  })

  it('keeps 12 pins from the same wish apart and on screen', () => {
    const pins: Array<{ x: number; y: number }> = []
    for (let i = 0; i < 12; i++) pins.push(freeSpot({ x: 700, y: 400 }, pins, 48, screen))
    for (let a = 0; a < pins.length; a++) {
      expect(pins[a]!.x).toBeGreaterThanOrEqual(screen.x)
      expect(pins[a]!.y).toBeGreaterThanOrEqual(screen.y)
      for (let b = a + 1; b < pins.length; b++) expect(Math.hypot(pins[a]!.x - pins[b]!.x, pins[a]!.y - pins[b]!.y)).toBeGreaterThanOrEqual(48 * 1.4 - 1)
    }
  })

  it('pulls a wish outside the screen back inside', () => {
    const p = freeSpot({ x: -500, y: 9000 }, [], 48, screen)
    expect(p.x).toBeGreaterThanOrEqual(screen.x)
    expect(p.y).toBeLessThanOrEqual(screen.y + screen.height)
  })
})
