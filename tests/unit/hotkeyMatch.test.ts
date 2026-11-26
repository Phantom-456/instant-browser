import { describe, expect, it } from 'vitest'
import { keyNameOf, matches, parseAccelerator } from '../../src/shared/hotkeyMatch'

const table = { B: 48, Space: 57, ArrowUp: 57416, Ctrl: 29, NumpadAdd: 78, F5: 63 }
const ev = (keycode: number, m: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
  ({ keycode, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m })

describe('hotkey match', () => {
  it('parses Option+Command+B', () => {
    expect(parseAccelerator('Alt+Command+B')).toEqual({ control: false, alt: true, shift: false, meta: true, key: 'B' })
  })
  it('parses the default and names', () => {
    expect(parseAccelerator('Control+Alt+Space')?.key).toBe('SPACE')
    expect(parseAccelerator('Alt+Up')?.key).toBe('ARROWUP')
    expect(parseAccelerator('CommandOrControl+F5')?.meta).toBe(true)
  })
  it('rejects bad accelerators', () => {
    expect(parseAccelerator('B')).toBeNull()
    expect(parseAccelerator('Alt+B+C')).toBeNull()
    expect(parseAccelerator('Alt+')).toBeNull()
    expect(parseAccelerator('Alt+Shift')).toBeNull()
  })
  it('matches only the exact modifiers and key', () => {
    const shape = parseAccelerator('Alt+Command+B')!
    expect(matches(shape, ev(48, { altKey: true, metaKey: true }), table)).toBe(true)
    expect(matches(shape, ev(48, { altKey: true }), table)).toBe(false)
    expect(matches(shape, ev(48, { altKey: true, metaKey: true, shiftKey: true }), table)).toBe(false)
    expect(matches(shape, ev(57, { altKey: true, metaKey: true }), table)).toBe(false)
  })
  it('does not treat modifier or numpad keys as the main key', () => {
    expect(keyNameOf(table, 29)).toBeNull()
    expect(keyNameOf(table, 78)).toBeNull()
    expect(keyNameOf(table, 48)).toBe('B')
  })
})
