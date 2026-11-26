import { posix, win32 } from 'node:path'

export interface HistorySource {
  /** Shown to the user, for example "Google Chrome". */
  name: string
  kind: 'chromium' | 'firefox'
  /** Chromium: the "User Data" folder. Firefox: the "Profiles" folder. */
  dir: string
}

/** Where each browser keeps its history. Only history files are read, never cookies or passwords. */
export function historySources(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined>): HistorySource[] {
  // Use the path style of the system we describe, so the result is the same on any computer (and testable anywhere).
  const join = platform === 'win32' ? win32.join : posix.join
  if (platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    return [
      { name: 'Dia', kind: 'chromium', dir: join(support, 'Dia', 'User Data') },
      { name: 'Arc', kind: 'chromium', dir: join(support, 'Arc', 'User Data') },
      { name: 'Google Chrome', kind: 'chromium', dir: join(support, 'Google', 'Chrome') },
      { name: 'Microsoft Edge', kind: 'chromium', dir: join(support, 'Microsoft Edge') },
      { name: 'Brave', kind: 'chromium', dir: join(support, 'BraveSoftware', 'Brave-Browser') },
      { name: 'Firefox', kind: 'firefox', dir: join(support, 'Firefox', 'Profiles') },
      { name: 'Zen', kind: 'firefox', dir: join(support, 'zen', 'Profiles') }
    ]
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const roaming = env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return [
      { name: 'Google Chrome', kind: 'chromium', dir: join(local, 'Google', 'Chrome', 'User Data') },
      { name: 'Microsoft Edge', kind: 'chromium', dir: join(local, 'Microsoft', 'Edge', 'User Data') },
      { name: 'Brave', kind: 'chromium', dir: join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { name: 'Firefox', kind: 'firefox', dir: join(roaming, 'Mozilla', 'Firefox', 'Profiles') }
    ]
  }
  return []
}

/** Chromium profile folders are "Default" and "Profile 1", "Profile 2", ... */
export function isChromiumProfileDir(name: string): boolean {
  return name === 'Default' || /^Profile \d+$/.test(name)
}
