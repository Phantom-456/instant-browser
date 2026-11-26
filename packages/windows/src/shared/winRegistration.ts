/**
 * How the Windows installer registers the app as a web browser, so it shows in Settings, Apps, Default apps.
 * build/installer.nsh writes these keys (HKCU, per user) and removes them on uninstall; a unit test keeps the
 * two in step. Electron's own app.isDefaultProtocolClient looks at the old per-protocol key, which Windows 10 and
 * 11 no longer use for the default browser, so the app reads the user's choice (UserChoice ProgId) instead.
 */
export const WIN_BROWSER_NAME = 'Instant Browser'
export const WIN_URL_PROG_ID = 'InstantBrowserURL'
export const WIN_CLIENT_KEY = `Software\\Clients\\StartMenuInternet\\${WIN_BROWSER_NAME}`
export const WIN_CAPABILITIES_KEY = `${WIN_CLIENT_KEY}\\Capabilities`

/** The key that holds the user's default app for a link scheme. */
export function userChoiceKey(scheme: 'http' | 'https'): string {
  return `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\UserChoice`
}

/** Reads ProgId out of `reg query <UserChoice> /v ProgId`. */
export function parseUserChoiceProgId(regOutput: string): string | null {
  const m = /^\s*ProgId\s+REG_SZ\s+(.+?)\s*$/im.exec(regOutput)
  return m ? m[1]! : null
}

/** Instant Browser is the default browser when both http and https go to its ProgId. */
export function isOurDefault(httpProgId: string | null, httpsProgId: string | null): boolean {
  return httpProgId === WIN_URL_PROG_ID && httpsProgId === WIN_URL_PROG_ID
}

/** Settings, Default apps, opened on this app's page (Windows 11; Windows 10 opens the list). */
export const WIN_DEFAULT_APPS_URL = `ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(WIN_BROWSER_NAME)}`
