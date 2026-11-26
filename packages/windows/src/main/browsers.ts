import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isTestMode } from './testMode'
import { WIN_BROWSER_NAME } from '../shared/winRegistration'
import { isRetiredWindowsBrowser, windowsBrowserName } from '../shared/winBrowsers'
import {
  MAC_BROWSERS,
  exePathFromCommand,
  openCommand,
  parseRegDefaultValue,
  parseRegSubkeys,
  type BrowserInfo
} from '../shared/browserCommands'

const run = promisify(execFile)
const REG_ROOTS = ['HKLM\\SOFTWARE\\Clients\\StartMenuInternet', 'HKCU\\SOFTWARE\\Clients\\StartMenuInternet']

async function detectMac(): Promise<BrowserInfo[]> {
  const folders = [
    '/Applications',
    join(homedir(), 'Applications'),
    '/System/Volumes/Preboot/Cryptexes/App/System/Applications' // Safari lives here
  ]
  return MAC_BROWSERS.filter((b) => folders.some((folder) => existsSync(join(folder, b.app)))).map(
    ({ id, name }) => ({ id, name })
  )
}

async function detectWindows(): Promise<BrowserInfo[]> {
  const found = new Map<string, BrowserInfo>()
  for (const root of REG_ROOTS) {
    let names: string[] = []
    try {
      names = parseRegSubkeys((await run('reg', ['query', root])).stdout)
    } catch {
      continue // this root does not exist
    }
    for (const name of names) {
      if (found.has(name) || name.toLowerCase() === WIN_BROWSER_NAME.toLowerCase() || /instant browser|talaria/i.test(name)) continue // not ourselves
      try {
        const out = (await run('reg', ['query', `${root}\\${name}\\shell\\open\\command`, '/ve'])).stdout
        const path = exePathFromCommand(parseRegDefaultValue(out) ?? '')
        if (!path || !existsSync(path) || isRetiredWindowsBrowser(name)) continue
        // Keep the key as the id (saved in settings), and show the name Windows stores for it.
        const label = await run('reg', ['query', `${root}\\${name}`, '/ve']).then((r) => parseRegDefaultValue(r.stdout), () => null)
        found.set(name, { id: name, name: windowsBrowserName(name, label), path })
      } catch {
        // no open command for this entry: skip it
      }
    }
  }
  return [...found.values()]
}

export async function detectBrowsers(): Promise<BrowserInfo[]> {
  if (isTestMode() && process.env.INSTANT_TEST_BROWSERS) {
    try { return JSON.parse(process.env.INSTANT_TEST_BROWSERS) as BrowserInfo[] } catch { return [] }
  }
  if (process.platform === 'darwin') return detectMac()
  if (process.platform === 'win32') return detectWindows()
  return []
}

export async function openInBrowser(browser: BrowserInfo, url: string): Promise<void> {
  const command = openCommand(process.platform, browser, url)
  if (!command) throw new Error(`Cannot open ${url} in ${browser.name}`)
  await run(command.cmd, command.args)
}
