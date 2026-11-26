import { app, nativeTheme, systemPreferences, type BaseWindow, type WebContents } from 'electron'
import { release } from 'node:os'
import { accentFor, backdropFallback, captionSymbolColor, supportsBackdrop } from '../shared/winLook'

/** Thin, rounded scrollbars without arrow buttons, like Windows 11's own (and the Mac's). */
export const PAGE_SCROLLBARS = [
  '::-webkit-scrollbar { width: 12px; height: 12px; background: transparent; }',
  '::-webkit-scrollbar-thumb { border: 4px solid transparent; border-radius: 6px; background: rgba(128, 128, 128, 0.55) padding-box; }',
  '::-webkit-scrollbar-thumb:hover { border-width: 3px; background-color: rgba(128, 128, 128, 0.8); }',
  '::-webkit-scrollbar-button, ::-webkit-scrollbar-corner { display: none; background: transparent; }'
].join('\n')

/**
 * Web pages on Windows get Windows 11 style scrollbars instead of the classic ones with arrows.
 * A user style sheet, so any page that styles its own scrollbars keeps them.
 * (Chromium's FluentScrollbar feature flag is not honoured by Electron 45: checked on Windows 11.)
 */
export function useFluentScrollbars(): void {
  if (process.platform !== 'win32') return
  app.on('web-contents-created', (_e, wc) => {
    wc.on('dom-ready', () => void wc.insertCSS(PAGE_SCROLLBARS, { cssOrigin: 'user' }).catch(() => {}))
  })
}

/** True on Windows 11 22H2 and later, where windows can have a Mica or acrylic backdrop. */
export const hasBackdrop = (): boolean => process.platform === 'win32' && supportsBackdrop(release())

/**
 * Window options for the Windows 11 look.
 * `material`: Mica for long-lived windows, acrylic for short-lived ones such as the search bar.
 * `captionHeight`: when set, our page draws the title bar and Windows draws only its own
 * minimize, maximize (with Snap layouts) and close buttons on top of it, in that height.
 */
export function windowsLook(material: 'mica' | 'acrylic', captionHeight?: number) {
  const dark = nativeTheme.shouldUseDarkColors
  return {
    ...(hasBackdrop()
      ? { backgroundMaterial: material, backgroundColor: '#00000000' }
      : { backgroundColor: backdropFallback(dark) }),
    ...(captionHeight
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#00000000', symbolColor: captionSymbolColor(dark), height: captionHeight }
        }
      : {})
  }
}

/** Tell one of our pages whether the app is dark: `<html data-theme="dark|light">`. */
export function markTheme(page: WebContents): void {
  if (process.platform !== 'win32' || page.isDestroyed()) return
  const dark = nativeTheme.shouldUseDarkColors
  // Windows' own accent colour (Settings > Personalization > Colors), like other Windows apps.
  let accent: ReturnType<typeof accentFor> = null
  try { accent = accentFor(systemPreferences.getAccentColor(), dark) } catch { /* keep our blue */ }
  const script = [
    `document.documentElement.dataset.theme = '${dark ? 'dark' : 'light'}'`,
    accent ? `document.documentElement.style.setProperty('--accent', '${accent.accent}')` : '',
    accent ? `document.documentElement.style.setProperty('--accent-soft', '${accent.soft}')` : ''
  ].filter(Boolean).join(';')
  void page.executeJavaScript(script, false).catch(() => {})
}

/**
 * Keep a Windows window right when the system switches light and dark: the caption glyphs, the plain
 * backdrop on older Windows, and the theme mark on our pages. On Windows the pages' own
 * prefers-color-scheme can say light while the window is dark (seen on Windows 11 build 26300,
 * and the reason the pin page already gets its theme from here), so the styles use data-theme.
 */
export function followThemeOnWindows(win: BaseWindow, withCaption: boolean, pages: WebContents[] = [], plainBackdrop = true): void {
  if (process.platform !== 'win32') return
  for (const page of pages) page.on('dom-ready', () => markTheme(page))
  const update = () => {
    if (win.isDestroyed()) return
    const dark = nativeTheme.shouldUseDarkColors
    if (plainBackdrop && !hasBackdrop()) win.setBackgroundColor(backdropFallback(dark))
    if (withCaption) win.setTitleBarOverlay({ color: '#00000000', symbolColor: captionSymbolColor(dark) })
    for (const page of pages) markTheme(page)
  }
  nativeTheme.on('updated', update)
  systemPreferences.on('accent-color-changed', update)
  win.on('closed', () => {
    nativeTheme.off('updated', update)
    systemPreferences.off('accent-color-changed', update)
  })
}
