import { describe, expect, test } from 'vitest'
import { accentFor, backdropFallback, captionSymbolColor, supportsBackdrop } from '../../src/shared/winLook'

describe('supportsBackdrop', () => {
  test('Windows 11 22H2 and later draw Mica and acrylic', () => {
    expect(supportsBackdrop('10.0.22621')).toBe(true)
    expect(supportsBackdrop('10.0.22631')).toBe(true)
    expect(supportsBackdrop('10.0.26100')).toBe(true)
  })
  test('Windows 10 and the first Windows 11 release do not', () => {
    expect(supportsBackdrop('10.0.19045')).toBe(false)
    expect(supportsBackdrop('10.0.22000')).toBe(false)
  })
  test('anything unreadable is treated as unsupported', () => {
    expect(supportsBackdrop('')).toBe(false)
    expect(supportsBackdrop('24.1.0')).toBe(false)
    expect(supportsBackdrop('10.0.x')).toBe(false)
  })
})

test('fallback and caption colours follow light and dark mode', () => {
  expect(backdropFallback(false)).toBe('#f3f3f3')
  expect(backdropFallback(true)).toBe('#202020')
  expect(captionSymbolColor(true)).toBe('#ffffff')
  expect(captionSymbolColor(false)).not.toBe(captionSymbolColor(true))
})

describe('accentFor', () => {
  test('light mode uses the system accent as it is', () => {
    expect(accentFor('0078d4ff', false)).toEqual({ accent: '#0078d4', soft: 'rgba(0, 120, 212, 0.16)' })
  })
  test('dark mode uses a lighter shade', () => {
    expect(accentFor('0078d4ff', true)).toEqual({ accent: '#66aee5', soft: 'rgba(102, 174, 229, 0.22)' })
  })
  test('unreadable values give null', () => {
    expect(accentFor('', false)).toBeNull()
    expect(accentFor('blue', true)).toBeNull()
  })
})
