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
