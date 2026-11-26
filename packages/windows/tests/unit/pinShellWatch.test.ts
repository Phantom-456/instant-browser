import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PinRecord } from '../../src/shared/pins/model'

/**
 * The released pin (shell) without a real Electron: the windows, views and system events are stand-ins.
 * Checks the parts that a smoke test cannot reach easily: many pins at once, wake-ups, and clean-up.
 */
const fake = vi.hoisted(() => ({ withImageView: true }))

vi.mock('electron', () => {
  class FakeView {
    bounds = { x: 0, y: 0, width: 0, height: 0 }
    radius = 0
    image: unknown = null
    setBounds(b: { x: number; y: number; width: number; height: number }) { this.bounds = b }
    setBorderRadius(r: number) { this.radius = r }
    setBackgroundColor() {}
    setImage(img: unknown) { this.image = img }
  }
  class FakeWindow {
    destroyed = false
    visible = false
    bounds: { x: number; y: number; width: number; height: number }
    contentView = { children: [] as FakeView[], addChildView: (v: FakeView) => { this.contentView.children.push(v) } }
    constructor(o: { x: number; y: number; width: number; height: number }) { this.bounds = { x: o.x, y: o.y, width: o.width, height: o.height } }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    setVisibleOnAllWorkspaces() {}
    setBackgroundColor() {}
    showInactive() { this.visible = true }
    hide() { this.visible = false }
    setBounds(b: { x: number; y: number; width: number; height: number }) { this.bounds = b }
    getBounds() { return this.bounds }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
  }
  const makeImage = (w: number, scale: number) => {
    const reps = [scale]
    return {
      addRepresentation: (o: { scaleFactor: number }) => { reps.push(o.scaleFactor) },
      getSize: () => ({ width: Math.round(w / scale), height: Math.round(w / scale) }),
      getScaleFactors: () => reps
    }
  }
  return {
    BaseWindow: FakeWindow,
    View: FakeView,
    get ImageView() { return fake.withImageView ? FakeView : undefined },
    nativeImage: { createFromBitmap: (_b: Buffer, o: { width: number; scaleFactor: number }) => makeImage(o.width, o.scaleFactor) },
    powerMonitor: new EventEmitter(),
    screen: Object.assign(new EventEmitter(), { getAllDisplays: () => [{ scaleFactor: 2 }] })
  }
})

const record = (following = false) => ({
  following,
  gradient: { seed: 1, angle: 0, stops: [{ h: 220, s: 80, l: 55 }, { h: 330, s: 80, l: 60 }] }
}) as unknown as PinRecord

afterEach(() => { vi.useRealTimers(); vi.resetModules() })

describe('released pins share one set of system listeners', () => {
  it('twenty released pins add one listener per system event, and removing them all removes the listeners', async () => {
    const { PinShell, shellWatch } = await import('../../src/main/pins/pinShell')
    const shells = Array.from({ length: 20 }, (_, i) => new PinShell(record(), { x: 100 + i * 40, y: 100 }, () => 30))
    expect(shellWatch()).toMatchObject({ shells: 20, resumeListeners: 1, displayListeners: 1 }) // not 20 (Node warns from 11)
    for (const s of shells) s.destroy()
    expect(shellWatch()).toMatchObject({ shells: 0, resumeListeners: 0, displayListeners: 0 })
    // and the next pin starts the watch again
    const again = new PinShell(record(), { x: 0, y: 0 }, () => 30)
    expect(shellWatch().resumeListeners).toBe(1)
    again.destroy()
  })

  it('a wake-up, an unlock and a display change draw every pin again; the pixels are drawn only once', async () => {
    const { PinShell } = await import('../../src/main/pins/pinShell')
    const { powerMonitor, screen } = await import('electron')
    const a = new PinShell(record(), { x: 100, y: 100 }, () => 30)
    const b = new PinShell(record(), { x: 200, y: 100 }, () => 30)
    const paints = () => [a.debug().paints, b.debug().paints]
    const before = paints()
    powerMonitor.emit('resume')
    powerMonitor.emit('unlock-screen')
    screen.emit('display-metrics-changed')
    expect(paints()).toEqual([before[0]! + 3, before[1]! + 3])
    expect(a.debug().draws).toBe(1)
    a.destroy()
    powerMonitor.emit('resume')
    expect(b.debug().paints).toBe(before[1]! + 4) // a destroyed pin is left alone
    b.destroy()
  })

  it('the regular redraw runs while pins exist and stops with the last one', async () => {
    vi.useFakeTimers()
    const { PinShell } = await import('../../src/main/pins/pinShell')
    const s = new PinShell(record(), { x: 100, y: 100 }, () => 30)
    const p = s.debug().paints
    vi.advanceTimersByTime(30_000)
    expect(s.debug().paints).toBe(p + 1)
    s.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('draws a new picture when the pin gets a new size, and shows it at the size of the window', async () => {
    const { PinShell } = await import('../../src/main/pins/pinShell')
    let d = 30
    const s = new PinShell(record(), { x: 100, y: 100 }, () => d)
    expect(s.debug()).toMatchObject({ mode: 'picture', views: 1, draws: 1, imageSize: { width: 34, height: 34 }, windowSize: { width: 34, height: 34 } })
    d = 40
    s.update(record())
    expect(s.debug()).toMatchObject({ draws: 2, imageSize: { width: 44, height: 44 }, windowSize: { width: 44, height: 44 } })
    s.destroy()
  })
})

describe('showing a released pin (v6)', () => {
  it('draws once when shown and once more a moment later; showing again quickly keeps one pending redraw', async () => {
    vi.useFakeTimers()
    const { PinShell } = await import('../../src/main/pins/pinShell')
    const s = new PinShell(record(), { x: 100, y: 100 }, () => 30)
    const p = s.debug().paints
    s.show()
    s.show()
    expect(s.debug().paints).toBe(p + 2)
    expect(vi.getTimerCount()).toBe(2) // the regular redraw and ONE pending redraw, not two
    vi.advanceTimersByTime(60)
    expect(s.debug().paints).toBe(p + 3)
    s.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a pin let go right after showing leaves no timer behind', async () => {
    vi.useFakeTimers()
    const { PinShell } = await import('../../src/main/pins/pinShell')
    const s = new PinShell(record(), { x: 100, y: 100 }, () => 30)
    s.show()
    s.destroy()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => vi.advanceTimersByTime(100)).not.toThrow()
  })

  it('a screen with a new scale (1.5) is drawn for when it is plugged in', async () => {
    const { PinShell } = await import('../../src/main/pins/pinShell')
    const { screen } = await import('electron')
    const s = new PinShell(record(), { x: 100, y: 100 }, () => 30)
    expect(s.debug().draws).toBe(1)
    const old = screen.getAllDisplays
    screen.getAllDisplays = (() => [{ scaleFactor: 2 }, { scaleFactor: 1.5 }]) as typeof old
    try {
      screen.emit('display-added')
      expect(s.debug().draws).toBe(2) // a new picture with a 1.5x drawing in it
      screen.emit('display-metrics-changed')
      expect(s.debug().draws).toBe(2) // nothing new: the picture is reused
    } finally {
      screen.getAllDisplays = old
      s.destroy()
    }
  })
})

describe('one picture shared by all released pins (v7)', () => {
  it('twenty pins of one size draw the picture once; a new size draws one more', async () => {
    const { PinShell, shellWatch } = await import('../../src/main/pins/pinShell')
    let d = 30
    const shells = Array.from({ length: 20 }, (_, i) => new PinShell(record(), { x: 100 + i * 40, y: 100 }, () => d))
    expect(shellWatch()).toMatchObject({ pictures: 1, pictureDraws: 1 })
    expect(shells.every((s) => s.debug().imageSize?.width === 34)).toBe(true)
    d = 40
    shells[0]!.update(record())
    expect(shellWatch()).toMatchObject({ pictures: 2, pictureDraws: 2 })
    expect(shells[0]!.debug().imageSize).toEqual({ width: 44, height: 44 })
    expect(shells[1]!.debug().imageSize).toEqual({ width: 34, height: 34 }) // the others keep their own size
    for (const s of shells) s.destroy()
  })

  it('keeps at most 8 pictures, dropping the one used longest ago', async () => {
    const { PinShell, shellWatch } = await import('../../src/main/pins/pinShell')
    const sizes = Array.from({ length: 10 }, (_, i) => 20 + i)
    const shells = sizes.map((size) => new PinShell(record(), { x: 0, y: 0 }, () => size))
    expect(shellWatch()).toMatchObject({ pictures: 8, pictureDraws: 10 })
    // size 20 was dropped: a new pin of that size draws it again; size 29 is still kept
    shells.push(new PinShell(record(), { x: 0, y: 0 }, () => 29))
    expect(shellWatch().pictureDraws).toBe(10)
    shells.push(new PinShell(record(), { x: 0, y: 0 }, () => 20))
    expect(shellWatch().pictureDraws).toBe(11)
    for (const s of shells) s.destroy()
  })
})

describe('without ImageView', () => {
  it('falls back to two round views', async () => {
    fake.withImageView = false
    try {
      const { PinShell } = await import('../../src/main/pins/pinShell')
      const s = new PinShell(record(), { x: 100, y: 100 }, () => 30)
      expect(s.debug()).toMatchObject({ mode: 'views', views: 2 })
      s.destroy()
    } finally {
      fake.withImageView = true
    }
  })
})
