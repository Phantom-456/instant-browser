import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PinStore } from '../../src/main/pins/pinStore'
import { contrast, generateGradient, hueDistance, hslToRgb, luminance, stopIsVisible } from '../../src/shared/pins/gradient'
import {
  PIN_STORE_VERSION, archivePin, clampPoint, clampRect, createPin, labelOf, normalizeLabel, parsePinFile, windowForPin,
  type GradientSpec, type PinRecord
} from '../../src/shared/pins/model'
import { DEFAULT_SETTINGS, PIN_LIMITS, PIN_SIZES, mergeSettings } from '../../src/shared/settings'

const grad = (seed = 1): GradientSpec => generateGradient([], seed)
const make = (id: string, over: Partial<PinRecord> = {}): PinRecord => ({
  ...createPin(
    { url: 'https://example.com/a', title: 'A', window: { x: 10, y: 10, width: 480, height: 640 }, pin: { x: 100, y: 100 }, following: false, gradient: grad() },
    id, 1000
  ),
  ...over
})

describe('gradient', () => {
  it('gives the same gradient for the same seed', () => {
    expect(generateGradient([], 42)).toEqual(generateGradient([], 42))
  })

  it('keeps every colour visible on a light and on a dark desktop', () => {
    for (let i = 0; i < 300; i++) {
      const g = generateGradient([], i * 7919)
      expect(g.stops.length).toBeGreaterThanOrEqual(2)
      for (const s of g.stops) {
        expect(stopIsVisible(s)).toBe(true)
        const y = luminance(hslToRgb(s.h, s.s, s.l))
        expect(contrast(y, 1)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps the first 12 pins well apart in hue', () => {
    const list: GradientSpec[] = []
    for (let i = 0; i < 12; i++) list.push(generateGradient(list, 1000 + i))
    let closest = 360
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) closest = Math.min(closest, hueDistance(list[a]!.stops[0]!.h, list[b]!.stops[0]!.h))
    }
    expect(closest).toBeGreaterThanOrEqual(10)
  })

  it('still makes a valid gradient for 200 pins', () => {
    const list: GradientSpec[] = []
    for (let i = 0; i < 200; i++) {
      const g = generateGradient(list, i + 5)
      expect(g.stops.every(stopIsVisible)).toBe(true)
      list.push(g)
    }
    expect(new Set(list.map((g) => g.seed)).size).toBeGreaterThan(190)
  })
})

describe('pin model', () => {
  it('uses the person name, then the title, then the site', () => {
    expect(labelOf({ label: 'Mine', title: 'T', url: 'https://x.com' })).toBe('Mine')
    expect(labelOf({ label: null, title: 'T', url: 'https://x.com' })).toBe('T')
    expect(labelOf({ label: null, title: '', url: 'https://www.x.com/a' })).toBe('x.com')
  })

  it('cuts a new name to 60 characters and clears it when empty', () => {
    expect(normalizeLabel('a'.repeat(100))).toHaveLength(60)
    expect(normalizeLabel('   ')).toBeNull()
    expect(normalizeLabel('  one   two ')).toBe('one two')
  })

  it('archives without losing anything', () => {
    const p = make('pin-00000001')
    const a = archivePin(p, 5)
    expect(a.archived).toBe(true)
    expect(a.archivedAt).toBe(5)
    expect(a.gradient).toEqual(p.gradient)
  })

  it('drops bad entries and duplicate ids, keeps the good ones', () => {
    const good = make('pin-00000001')
    const out = parsePinFile({ version: PIN_STORE_VERSION, pins: [good, { id: 'x' }, good, null, { ...good, id: 'pin-00000002', url: '' }] })
    expect(out.pins.map((p) => p.id)).toEqual(['pin-00000001'])
    expect(out.dropped).toBe(4)
  })

  it('rejects a file with another version', () => {
    expect(parsePinFile({ version: 99, pins: [] }).versionOk).toBe(false)
    expect(parsePinFile('nope').versionOk).toBe(false)
  })

  it('moves a window and a pin back onto the screen', () => {
    const screens = [{ x: 0, y: 0, width: 1000, height: 800 }]
    expect(clampRect({ x: 1500, y: -200, width: 480, height: 640 }, screens)).toEqual({ x: 520, y: 0, width: 480, height: 640 })
    expect(clampRect({ x: 0, y: 0, width: 3000, height: 3000 }, screens)).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
    expect(clampPoint({ x: 5000, y: 5000 }, screens, 24)).toEqual({ x: 976, y: 776 })
  })

  it('picks the nearer screen when a display was removed', () => {
    const screens = [{ x: 0, y: 0, width: 1000, height: 800 }, { x: 1000, y: 0, width: 1000, height: 800 }]
    expect(clampPoint({ x: 2600, y: 100 }, screens).x).toBe(2000)
  })
})

describe('pin store', () => {
  const fresh = () => mkdtempSync(join(tmpdir(), 'ib-pins-'))

  it('saves, reloads, updates and deletes', () => {
    const dir = fresh()
    const store = new PinStore(dir)
    store.put(make('pin-00000001'))
    store.put(make('pin-00000002'))
    expect(store.update('pin-00000001', (p) => ({ ...p, label: 'Docs' }))?.label).toBe('Docs')
    const again = new PinStore(dir)
    expect(again.all().map((p) => p.id)).toEqual(['pin-00000001', 'pin-00000002'])
    expect(again.get('pin-00000001')?.label).toBe('Docs')
    again.delete('pin-00000002')
    expect(new PinStore(dir).all()).toHaveLength(1)
  })

  it('writes the file private to the user and leaves no temporary file', () => {
    const dir = fresh()
    new PinStore(dir).put(make('pin-00000001'))
    if (process.platform !== 'win32') expect(statSync(join(dir, 'pins.json')).mode & 0o777).toBe(0o600) // file modes mean nothing on Windows
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, 'pins.json'), 'utf8')).version).toBe(PIN_STORE_VERSION)
  })

  it('keeps a broken file aside and starts empty', () => {
    const dir = fresh()
    writeFileSync(join(dir, 'pins.json'), '{ not json')
    const store = new PinStore(dir, () => 123)
    expect(store.all()).toEqual([])
    expect(store.recovered.brokenFile).toBe(join(dir, 'pins.json.broken-123'))
    expect(readFileSync(join(dir, 'pins.json.broken-123'), 'utf8')).toBe('{ not json')
  })

  it('refuses a snapshot path made from a bad id', () => {
    expect(() => new PinStore(fresh()).snapshotPath('../evil')).toThrow()
  })
})

describe('pin settings', () => {
  it('has the decided defaults, with both automatic offloads off', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      pinSize: 28, maxPins: 12, autoOffloadInactivity: false, autoOffloadMinutes: 30, autoOffloadMemory: false, autoOffloadMemoryGB: 1.5
    })
  })

  it('keeps the values inside their ranges', () => {
    const s = mergeSettings({ pinSize: 5, maxPins: 999, autoOffloadMinutes: 1, autoOffloadMemoryGB: 99 })
    expect([s.pinSize, s.maxPins, s.autoOffloadMinutes, s.autoOffloadMemoryGB]).toEqual([19, 40, 5, 8])
    const t = mergeSettings({ pinSize: 500, maxPins: 1, autoOffloadMinutes: 9999, autoOffloadMemoryGB: 0.01 })
    expect([t.pinSize, t.maxPins, t.autoOffloadMinutes, t.autoOffloadMemoryGB]).toEqual([37, 4, 240, 0.5])
    expect(mergeSettings({ pinSize: 'big' }).pinSize).toBe(28)
    expect([mergeSettings({ pinArmMs: -5 }).pinArmMs, mergeSettings({ pinArmMs: 999999 }).pinArmMs, mergeSettings({}).pinArmMs, mergeSettings({ pinArmMs: 1250 }).pinArmMs]).toEqual([0, 30000, 2000, 1250])
  })
})

describe('pin sizes', () => {
  it('offers three smaller and three larger sizes around the default, all inside the limits', () => {
    const values = PIN_SIZES.map((p) => p.value)
    const at = values.indexOf(DEFAULT_SETTINGS.pinSize)
    expect(at).toBe(3)
    expect(values).toHaveLength(7)
    expect([...values].sort((a, b) => a - b)).toEqual(values)
    for (const v of values) expect(mergeSettings({ pinSize: v }).pinSize).toBe(v)
    expect(values[0]).toBe(PIN_LIMITS.size.min)
    expect(values[6]).toBe(PIN_LIMITS.size.max)
  })
})

describe('where a window opens for its pin', () => {
  const win = { x: 500, y: 300, width: 480, height: 640 }
  it('puts the button on the pin', () => {
    expect(windowForPin(win, { x: 40, y: 24 }, { x: 900, y: 120 })).toEqual({ x: 860, y: 96, width: 480, height: 640 })
  })
  it('uses the middle of the top bar for an old pin that has no saved button place', () => {
    expect(windowForPin(win, null, { x: 900, y: 120 })).toEqual({ x: 660, y: 96, width: 480, height: 640 })
  })
  it('can be kept on screen when the pin is near an edge', () => {
    const screen = [{ x: 0, y: 25, width: 1440, height: 800 }]
    const placed = clampRect(windowForPin(win, { x: 40, y: 24 }, { x: 1430, y: 800 }), screen, 0)
    expect(placed.x + placed.width).toBeLessThanOrEqual(1440)
    expect(placed.y + placed.height).toBeLessThanOrEqual(825)
  })
})
