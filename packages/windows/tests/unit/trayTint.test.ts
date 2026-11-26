import { expect, test } from 'vitest'
import { TRAY_ON_DARK, TRAY_ON_LIGHT, recolourBitmap, trayColour } from '../../src/shared/trayTint'

test('white on a dark taskbar, black on a light one', () => {
  expect(trayColour(true)).toEqual(TRAY_ON_DARK)
  expect(trayColour(false)).toEqual(TRAY_ON_LIGHT)
})
test('recolouring keeps the shape (alpha) and premultiplies the colour', () => {
  // three pixels: solid black, half transparent black, fully transparent
  const black = Buffer.from([0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0])
  const white = recolourBitmap(black, TRAY_ON_DARK)
  expect([...white]).toEqual([255, 255, 255, 255, 128, 128, 128, 128, 0, 0, 0, 0])
  expect([...black]).toEqual([0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0]) // the input is not changed
})
test('a buffer that is not 4 bytes a pixel is refused', () => {
  expect(() => recolourBitmap(Buffer.from([1, 2, 3]), TRAY_ON_DARK)).toThrow()
})
