import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DIA_LIST_SCRIPT, DIA_OPEN_SCRIPT, parseProfileNames } from '../shared/dia'
import { isTestMode } from './testMode'

const run = promisify(execFile)

/** Dia is running now. We never start Dia just to ask it something. */
async function diaIsRunning(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  try {
    await run('pgrep', ['-x', 'Dia'])
    return true
  } catch {
    return false
  }
}

/** The names of Dia's profiles, or null when Dia is not running or does not answer. */
export async function listDiaProfiles(): Promise<string[] | null> {
  if (isTestMode()) return process.env.INSTANT_TEST_DIA_PROFILES ? parseProfileNames(process.env.INSTANT_TEST_DIA_PROFILES.replaceAll(',', '\n')) : null
  if (!(await diaIsRunning())) return null
  try {
    const { stdout } = await run('osascript', ['-e', DIA_LIST_SCRIPT], { timeout: 4000 })
    const names = parseProfileNames(stdout)
    return names.length ? names : null
  } catch {
    return null // no window, or macOS has not allowed Instant Browser to control Dia
  }
}

/** Open the link as a new tab in the named Dia profile. Returns false when that did not work (the caller then opens it normally). */
export async function openInDiaProfile(url: string, profile: string): Promise<boolean> {
  if (!(await diaIsRunning())) return false
  try {
    await run('osascript', ['-e', DIA_OPEN_SCRIPT, profile, url], { timeout: 6000 })
    return true
  } catch {
    return false
  }
}
