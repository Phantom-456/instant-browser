/**
 * Names of the browsers Windows lists under StartMenuInternet. Each key's default value is the
 * name people know ("Firefox", "Brave"); the key itself can be an exe name or carry an install
 * id ("IEXPLORE.EXE", "Firefox-308046B0AF4A39CB").
 */

/** Internet Explorer is still registered on Windows 11, but only opens Edge. */
export function isRetiredWindowsBrowser(key: string): boolean {
  return /^iexplore\.exe$/i.test(key.trim())
}

/** The name to show: the key's default value when it has one, else the key without an install id or .exe. */
export function windowsBrowserName(key: string, defaultValue: string | null): string {
  const named = defaultValue?.trim()
  if (named) return named
  return key.trim().replace(/\.exe$/i, '').replace(/-[0-9A-F]{8,}$/i, '')
}
