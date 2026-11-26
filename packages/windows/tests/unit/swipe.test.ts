import { describe, expect, it } from 'vitest'
import { SWIPE_GAP_MS, SWIPE_THRESHOLD, feedSwipe, newSwipe, swipeEnded, type SwipeState, type SwipeUpdate } from '../../src/shared/swipe'

/** Feed a list of wheel events, 16 ms apart. */
function run(deltas: Array<[number, number]>, start = 1000) {
  let state: SwipeState = newSwipe()
  const out: SwipeUpdate[] = []
  deltas.forEach(([x, y], i) => {
    const u = feedSwipe(state, x, y, start + i * 16)
    state = u.state
    out.push(u)
  })
  return { state, updates: out }
}

describe('two-finger swipe', () => {
  it('swiping the fingers right (negative scroll) goes back, left goes forward', () => {
    expect(run([[-30, 0], [-30, 0]]).updates.at(-1)!.direction).toBe('back')
    expect(run([[30, 0], [30, 0]]).updates.at(-1)!.direction).toBe('forward')
  })

  it('fires once, when the swipe passes the line, and not again while the fingers stay down', () => {
    const many = Array.from({ length: 30 }, () => [-20, 0] as [number, number])
    const { updates } = run(many)
    const fired = updates.filter((u) => u.fire)
    expect(fired).toHaveLength(1)
    expect(fired[0]!.progress).toBe(1)
    expect(updates[0]!.fire).toBe(false)
  })

  it('shows progress from 0 to 1 as the swipe goes on', () => {
    const { updates } = run([[-40, 0], [-40, 0], [-40, 0]])
    expect(updates.map((u) => u.progress)).toEqual([40 / SWIPE_THRESHOLD, 80 / SWIPE_THRESHOLD, 120 / SWIPE_THRESHOLD])
  })

  it('ignores up and down scrolling, and small sideways drift', () => {
    expect(run(Array.from({ length: 20 }, () => [-3, -30] as [number, number])).updates.some((u) => u.active)).toBe(false)
    expect(run([[-5, 0], [-4, 0]]).updates.at(-1)!.active).toBe(false)
    // A diagonal that is mostly vertical is a scroll, not a swipe.
    expect(run(Array.from({ length: 20 }, () => [-20, -30] as [number, number])).updates.some((u) => u.fire)).toBe(false)
  })

  it('a pause starts a new swipe, which can fire again', () => {
    const a = run(Array.from({ length: 12 }, () => [-20, 0] as [number, number]), 1000)
    expect(a.updates.some((u) => u.fire)).toBe(true)
    const next = feedSwipe(a.state, -20, 0, a.state.lastAt + SWIPE_GAP_MS + 1)
    expect(next.state.fired).toBe(false)
    expect(next.state.sumX).toBe(-20)
  })

  it('knows when the swipe has ended', () => {
    const { state } = run([[-30, 0]])
    expect(swipeEnded(state, state.lastAt + SWIPE_GAP_MS - 1)).toBe(false)
    expect(swipeEnded(state, state.lastAt + SWIPE_GAP_MS + 1)).toBe(true)
  })
})
