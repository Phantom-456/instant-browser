import { isAllowedUrl } from './urlPolicy'

export interface BrowserInfo {
  id: string
  name: string
  /** Windows only: full path of the browser's exe. */
  path?: string
}

/** Browsers we look for on Mac. `app` is the name in /Applications. Order = menu order. */
export const MAC_BROWSERS: ReadonlyArray<{ id: string; name: string; app: string }> = [
  { id: 'company.thebrowser.dia', name: 'Dia', app: 'Dia.app' },
  { id: 'company.thebrowser.Browser', name: 'Arc', app: 'Arc.app' },
  { id: 'com.google.Chrome', name: 'Google Chrome', app: 'Google Chrome.app' },
  { id: 'com.microsoft.edgemac', name: 'Microsoft Edge', app: 'Microsoft Edge.app' },
  { id: 'com.brave.Browser', name: 'Brave', app: 'Brave Browser.app' },
  { id: 'org.mozilla.firefox', name: 'Firefox', app: 'Firefox.app' },
  { id: 'app.zen-browser.zen', name: 'Zen', app: 'Zen.app' },
  { id: 'com.apple.Safari', name: 'Safari', app: 'Safari.app' }
]

/** The program and arguments that open a URL in one browser. No shell is used. */
export function openCommand(
  platform: NodeJS.Platform,
  browser: BrowserInfo,
  url: string
): { cmd: string; args: string[] } | null {
  if (!isAllowedUrl(url) || url === 'about:blank') return null
  if (platform === 'darwin') return { cmd: 'open', args: ['-b', browser.id, url] }
  if (platform === 'win32' && browser.path) return { cmd: browser.path, args: [url] }
  return null
}

/** Names of the keys under ...\Clients\StartMenuInternet from `reg query` output. */
export function parseRegSubkeys(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\\StartMenuInternet\\[^\\]+$/i.test(line))
    .map((line) => line.slice(line.lastIndexOf('\\') + 1))
}

/** The "(Default)" value from `reg query <key> /ve` output. */
export function parseRegDefaultValue(output: string): string | null {
  const match = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(output)
  return match?.[1] ?? null
}

/** The exe path at the start of a Windows command line. */
export function exePathFromCommand(command: string): string | null {
  const text = command.trim()
  if (!text) return null
  const quoted = /^"([^"]+)"/.exec(text)
  if (quoted?.[1]) return quoted[1]
  const bare = /^(.+?\.exe)\b/i.exec(text)
  return bare?.[1] ?? null
}

/** The browser that "send" uses: the one from settings, else the first one found. */
export function pickMainBrowser(all: BrowserInfo[], wantedId: string | null): BrowserInfo | null {
  return all.find((browser) => browser.id === wantedId) ?? all[0] ?? null
}

/** Web URLs passed on the command line (how Windows hands over a clicked link). */
export function urlsFromArgv(argv: string[]): string[] {
  return argv.filter((arg) => /^https?:\/\//i.test(arg) && isAllowedUrl(arg))
}
