import { describe, expect, it, vi } from 'vitest'
import type { PinRecord } from '../../src/shared/pins/model'

/** The pin surface with stand-ins for the real pin window and the bare shell, so the hand-over between them can be played step by step. */
const made = vi.hoisted(() => ({ windows: [] as unknown[], shells: [] as unknown[] }))

vi.mock('../../src/main/pins/pinShell', () => ({
  PinShell: class {
    destroyed = false
    centrePoint = { x: 100, y: 100 }
    constructor() { made.shells.push(this) }
    show() {}
    update() {}
    moveTo() {}
    debug() { return {} }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
  }
}))

vi.mock('../../src/main/pins/pinWindows', () => ({
  PinWindow: class {
    destroyed = false
    ready: (() => void) | null = null
    centrePoint = { x: 100, y: 100 }
    constructor() { made.windows.push(this) }
    onReady(cb: () => void) { this.ready = cb }
    hoverNow() {}
    isAtRest() { return true }
    show() {}
    update() {}
    moveTo() {}
    setCountdown() {}
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
  }
}))

type FakeWindow = { ready: (() => void) | null; destroyed: boolean }
type FakeShell = { destroyed: boolean }

const record = { state: 'offloaded', following: false } as unknown as PinRecord
const deps = { diameter: () => 30, workAreaFor: () => ({ x: 0, y: 0, width: 1000, height: 800 }), onEvent: () => {} }

describe('pin surface: the bare shell and the real pin window', () => {
  it('the shell goes when the real window has drawn', async () => {
    made.windows.length = 0; made.shells.length = 0
    const { PinSurface } = await import('../../src/main/pins/pinSurface')
    const s = new PinSurface(record, { x: 100, y: 100 }, deps)
    s.poll({ x: 100, y: 100 }, 0) // pointer on the pin: a real window starts
    const w = made.windows[0] as FakeWindow
    expect(s.hasShell()).toBe(true) // still there until the window has drawn
    w.ready!()
    expect(s.hasShell()).toBe(false)
  })

  it('a window let go before it drew does not take the shell with it (the pin never vanishes)', async () => {
    made.windows.length = 0; made.shells.length = 0
    const { PinSurface } = await import('../../src/main/pins/pinSurface')
    const s = new PinSurface(record, { x: 100, y: 100 }, deps)
    s.poll({ x: 100, y: 100 }, 0)
    const w = made.windows[0] as FakeWindow
    // The pointer has gone and the window is at rest long enough: it is let go before its page has drawn.
    s.poll({ x: 900, y: 700 }, 10)
    s.poll({ x: 900, y: 700 }, 10 + 5_000)
    expect(w.destroyed).toBe(true)
    expect(s.hasWindow()).toBe(false)
    // Its late "drawn" signal arrives now: the shell must stay.
    w.ready!()
    expect(s.hasShell()).toBe(true)
    expect((made.shells[0] as FakeShell).destroyed).toBe(false)
  })

  it('a late signal from an old window does not remove the shell that a newer window still needs', async () => {
    made.windows.length = 0; made.shells.length = 0
    const { PinSurface } = await import('../../src/main/pins/pinSurface')
    const s = new PinSurface(record, { x: 100, y: 100 }, deps)
    s.poll({ x: 100, y: 100 }, 0)
    const old = made.windows[0] as FakeWindow
    s.poll({ x: 900, y: 700 }, 10)
    s.poll({ x: 900, y: 700 }, 10 + 5_000) // let go
    s.poll({ x: 100, y: 100 }, 20_000) // the pointer is back: a second window starts
    const fresh = made.windows[1] as FakeWindow
    old.ready!() // the old one is late
    expect(s.hasShell()).toBe(true)
    fresh.ready!() // the new one has drawn
    expect(s.hasShell()).toBe(false)
  })
})
