import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { isOurDefault, parseUserChoiceProgId, userChoiceKey } from '../shared/winRegistration'
import { promisify } from 'node:util'
import { WinKeyReader } from './winKeyReader'

const run = promisify(execFile)

// Reads which modifier keys are down right now. This needs no permission on macOS.
const SCRIPT = 'ObjC.import("AppKit"); String($.NSEvent.modifierFlags)'

import { isTestMode } from './testMode'

export { isTestMode }

/** True when the system sends web links to Instant Browser. */
export function isDefaultBrowser(): boolean {
  if (isTestMode()) return process.env.INSTANT_TEST_DEFAULT !== '0'
  if (process.platform === 'win32') return isWindowsDefault()
  return app.isDefaultProtocolClient('https') && app.isDefaultProtocolClient('http')
}

// Windows keeps the user's choice in UserChoice; it is read at most every 3 seconds (a link and Settings both ask).
let winDefault: { at: number; value: boolean } | null = null
function isWindowsDefault(): boolean {
  if (winDefault && Date.now() - winDefault.at < 3000) return winDefault.value
  const progId = (scheme: 'http' | 'https'): string | null => {
    try {
      return parseUserChoiceProgId(execFileSync('reg', ['query', userChoiceKey(scheme), '/v', 'ProgId'], { encoding: 'utf8', timeout: 2000, windowsHide: true }))
    } catch {
      return null // no choice saved: Windows uses Edge
    }
  }
  winDefault = { at: Date.now(), value: isOurDefault(progId('http'), progId('https')) }
  return winDefault.value
}

// The keys held and the app in front, in one call. The app in front is the one the user was in when the link arrived.
const CONTEXT_SCRIPT =
  'ObjC.import("AppKit"); const a=$.NSWorkspace.sharedWorkspace.frontmostApplication; ' +
  'JSON.stringify({mask:Number($.NSEvent.modifierFlags), front:a&&a.bundleIdentifier?ObjC.unwrap(a.bundleIdentifier):null})'

export interface LinkContext {
  /** The mac modifier mask, or null when it cannot be read. */
  mask: number | null
  /** The app that was in front, or null when unknown: a bundle id on Mac, a process name in lower case on Windows. */
  frontApp: string | null
}

// Windows: a PowerShell helper that stays running (see winKeyReader.ts).
let winKeys: WinKeyReader | null = null

/** Windows: starts the key helper early, so the first link does not wait for PowerShell. */
export function startLinkContextReader(): void {
  if (process.platform !== 'win32' || isTestMode()) return
  winKeys ??= new WinKeyReader()
  void winKeys.start()
}

export function stopLinkContextReader(): void {
  winKeys?.stop()
  winKeys = null
}

export async function readLinkContext(): Promise<LinkContext> {
  if (isTestMode()) return { mask: Number(process.env.INSTANT_TEST_MASK ?? 0), frontApp: process.env.INSTANT_TEST_FRONT_APP ?? null }
  if (process.platform === 'win32') {
    winKeys ??= new WinKeyReader()
    return winKeys.read()
  }
  if (process.platform !== 'darwin') return { mask: null, frontApp: null }
  try {
    const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', CONTEXT_SCRIPT], { timeout: 2000 })
    const parsed = JSON.parse(stdout.trim()) as { mask?: unknown; front?: unknown }
    return {
      mask: typeof parsed.mask === 'number' && Number.isFinite(parsed.mask) ? parsed.mask : null,
      frontApp: typeof parsed.front === 'string' ? parsed.front : null
    }
  } catch {
    return { mask: null, frontApp: null }
  }
}

/** The name of the app macOS sends web links to now, for example "Safari". */
export function currentWebLinkApp(): string | null {
  if (isTestMode()) return process.env.INSTANT_TEST_WEB_APP ?? null
  try {
    return app.getApplicationNameForProtocol('https://') || null
  } catch {
    return null
  }
}

/** The mac modifier mask, or null when it cannot be read (then the link opens in a mini window). */
export async function readModifierMask(): Promise<number | null> {
  if (isTestMode()) return Number(process.env.INSTANT_TEST_MASK ?? 0)
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', SCRIPT], { timeout: 2000 })
    const mask = Number(stdout.trim())
    return Number.isFinite(mask) ? mask : null
  } catch {
    return null
  }
}
