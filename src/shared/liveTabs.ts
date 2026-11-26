/**
 * Open tabs of the other browsers on this computer (Mac only, through AppleScript).
 * macOS asks the user for permission once for each browser. No browser tells other apps when a tab was made, so
 * "first seen" is the time Talaria first noticed the tab.
 */

export interface TabBrowser {
  /** Shown to the user. */
  name: string
  /** The name macOS gives the running program (for pgrep). */
  process: string
  /** The app name AppleScript uses. */
  app: string
  /** Chromium browsers give every tab an id. Safari does not. */
  family: 'chromium' | 'safari'
}

export const TAB_BROWSERS: TabBrowser[] = [
  { name: 'Google Chrome', process: 'Google Chrome', app: 'Google Chrome', family: 'chromium' },
  { name: 'Microsoft Edge', process: 'Microsoft Edge', app: 'Microsoft Edge', family: 'chromium' },
  { name: 'Brave', process: 'Brave Browser', app: 'Brave Browser', family: 'chromium' },
  { name: 'Arc', process: 'Arc', app: 'Arc', family: 'chromium' },
  { name: 'Vivaldi', process: 'Vivaldi', app: 'Vivaldi', family: 'chromium' },
  { name: 'Safari', process: 'Safari', app: 'Safari', family: 'safari' }
]

/** One line per tab, fields split by a tab character: window, tab, address, title. */
export function tabScript(b: TabBrowser): string {
  const id = b.family === 'chromium' ? 'id of t' : 'index of t'
  const title = b.family === 'chromium' ? 'title of t' : 'name of t'
  return [
    `tell application "${b.app}"`,
    'set out to ""',
    'repeat with w in windows',
    'set wid to id of w',
    'repeat with t in tabs of w',
    `set out to out & wid & tab & (${id}) & tab & (URL of t) & tab & (${title}) & linefeed`,
    'end repeat',
    'end repeat',
    'return out',
    'end tell'
  ].join('\n')
}

export interface RawTab { window: string; tab: string; url: string; title: string }

export function parseTabOutput(text: string): RawTab[] {
  const out: RawTab[] = []
  for (const line of text.split('\n')) {
    const [window, tab, url, ...title] = line.split('\t')
    if (!window || !tab || !url || !/^https?:\/\//i.test(url)) continue
    out.push({ window, tab, url, title: title.join('\t').trim() })
  }
  return out
}

/** One open tab, as shown in the list. */
export interface LiveTab {
  browser: string
  url: string
  title: string
  /** When Talaria first noticed this tab (milliseconds). */
  firstSeen: number
}

/** What happened when we asked a browser. */
export type TabState = 'ok' | 'not-running' | 'denied' | 'error'
export interface TabBrowserStatus { name: string; state: TabState }

/**
 * The key that follows one tab over time. Chromium tabs have an id, so the key survives a change of address.
 * Safari tabs have only a position, so the address is part of the key.
 */
export function tabKey(b: TabBrowser, t: RawTab): string {
  return b.family === 'chromium' ? `${b.name}|${t.window}|${t.tab}` : `${b.name}|${t.window}|${t.url}`
}

/**
 * Give each tab its first-seen time. `seen` is the memory from before: it is kept for tabs that are still open,
 * and tabs we have not seen get `now`. Tabs of a browser that was not asked (or failed) are left as they were.
 */
export function stampTabs(
  seen: Record<string, number>,
  asked: Array<{ browser: TabBrowser; tabs: RawTab[] | null }>,
  now: number
): { seen: Record<string, number>; tabs: LiveTab[] } {
  const next: Record<string, number> = {}
  const tabs: LiveTab[] = []
  const answered = new Set(asked.filter((a) => a.tabs !== null).map((a) => a.browser.name))
  for (const [key, time] of Object.entries(seen)) {
    const owner = key.split('|')[0] as string
    if (!answered.has(owner)) next[key] = time // not asked this time: keep what we knew
  }
  for (const { browser, tabs: list } of asked) {
    if (!list) continue
    for (const t of list) {
      const key = tabKey(browser, t)
      const first = seen[key] ?? now
      next[key] = first
      tabs.push({ browser: browser.name, url: t.url, title: t.title || t.url, firstSeen: first })
    }
  }
  return { seen: next, tabs }
}

/** AppleScript says error -1743 when the user has not allowed (or has blocked) the control of an app. */
export function isPermissionError(message: string): boolean {
  return /-1743|not authorized|not allowed/i.test(message)
}
