/**
 * The tray icon is a black "template" picture. macOS colours template pictures for the menu bar by itself; Windows
 * does not, so a black icon disappears on the dark taskbar (the Windows 11 default). These helpers give the colour
 * to draw it in, and recolour the raw picture while keeping its shape (the alpha channel).
 */
export interface Rgb { r: number; g: number; b: number }

export const TRAY_ON_DARK: Rgb = { r: 255, g: 255, b: 255 }
export const TRAY_ON_LIGHT: Rgb = { r: 0, g: 0, b: 0 }

/** The colour for the Windows taskbar: `darkTaskbar` is nativeTheme.shouldUseDarkColorsForSystemIntegratedUI. */
export function trayColour(darkTaskbar: boolean): Rgb {
  return darkTaskbar ? TRAY_ON_DARK : TRAY_ON_LIGHT
}

/**
 * Recolour a raw 32-bit bitmap (as nativeImage.toBitmap gives it: 4 bytes a pixel, BGRA on Windows and Linux, RGBA
 * on some others; both put alpha last, and the colour is written to all three colour bytes the same way only when
 * r, g and b are equal, so callers pass a grey). Pixels are premultiplied, so each colour byte is scaled by alpha.
 */
export function recolourBitmap(bitmap: Buffer, colour: Rgb): Buffer {
  if (bitmap.length % 4 !== 0) throw new Error('not a 32-bit bitmap')
  const out = Buffer.from(bitmap)
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]!
    out[i] = Math.round((colour.b * a) / 255)
    out[i + 1] = Math.round((colour.g * a) / 255)
    out[i + 2] = Math.round((colour.r * a) / 255)
  }
  return out
}
