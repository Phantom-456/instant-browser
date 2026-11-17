import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Reads which modifier keys are down right now. This needs no permission on macOS.
const SCRIPT = 'ObjC.import("AppKit"); String($.NSEvent.modifierFlags)'

import { isTestMode } from './testMode'

export { isTestMode }

/** True when the system sends web links to Instant Browser. */
export function isDefaultBrowser(): boolean {
  if (isTestMode()) return process.env.INSTANT_TEST_DEFAULT !== '0'
  return app.isDefaultProtocolClient('https') && app.isDefaultProtocolClient('http')
}

// The keys held and the app in front, in one call. The app in front is the one the user was in when the link arrived.
const CONTEXT_SCRIPT =
  'ObjC.import("AppKit"); const a=$.NSWorkspace.sharedWorkspace.frontmostApplication; ' +
  'JSON.stringify({mask:Number($.NSEvent.modifierFlags), front:a&&a.bundleIdentifier?ObjC.unwrap(a.bundleIdentifier):null})'

export interface LinkContext {
  /** The mac modifier mask, or null when it cannot be read. */
  mask: number | null
  /** Bundle id of the app that was in front, or null when unknown. */
  frontApp: string | null
}

export async function readLinkContext(): Promise<LinkContext> {
  if (isTestMode()) return { mask: Number(process.env.INSTANT_TEST_MASK ?? 0), frontApp: process.env.INSTANT_TEST_FRONT_APP ?? null }
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
