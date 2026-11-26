/**
 * The Windows 11 look: which system backdrop a window can have, and the colours around it.
 * Pure functions, so the rules can be tested anywhere.
 */

/** Mica and acrylic backdrops need Windows 11 22H2 (build 22621) or later. */
export const MATERIAL_MIN_BUILD = 22621

/** True when `os.release()` (like "10.0.22631") is a Windows build that draws Mica and acrylic. */
export function supportsBackdrop(release: string): boolean {
  const build = Number(release.split('.')[2])
  return Number.isFinite(build) && build >= MATERIAL_MIN_BUILD
}

/**
 * The plain colour a window shows where Mica would be, used on older Windows.
 * These are Windows 11's own Mica fallback colours.
 */
export function backdropFallback(dark: boolean): string {
  return dark ? '#202020' : '#f3f3f3'
}

/** Width that Windows' minimize, maximize and close buttons take on the right of a 48px title bar. */
export const CAPTION_BUTTONS_WIDTH = 138

/** The colour of the glyphs in the system caption buttons. */
export function captionSymbolColor(dark: boolean): string {
  return dark ? '#ffffff' : '#1a1a1a'
}

/**
 * The Windows accent colour for our pages. `systemAccent` is what Electron's
 * systemPreferences.getAccentColor() gives on Windows: 'RRGGBBAA'. In dark mode Windows uses lighter
 * shades of the accent, so it is mixed 40% towards white there, as the WinUI "AccentLight" shades do.
 * Null when the value can't be read: the pages then keep their own blue.
 */
export function accentFor(systemAccent: string, dark: boolean): { accent: string; soft: string } | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(systemAccent.trim())
  if (!m) return null
  const mix = dark ? 0.4 : 0
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * mix))
  const hex = '#' + [r, g, b].map((n) => n!.toString(16).padStart(2, '0')).join('')
  return { accent: hex, soft: `rgba(${r}, ${g}, ${b}, ${dark ? 0.22 : 0.16})` }
}
