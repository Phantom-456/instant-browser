import { globalShortcut } from 'electron'
import { execFile } from 'node:child_process'
import { isTestMode } from './testMode'
import { isUsableHotkey, makePressFilter, parseKeyboardDelay, repeatGapMs } from '../shared/hotkeyChoice'

let current: string | null = null
let changed: (active: string | null) => void = () => {}

/** Called whenever the active key changes (registered, replaced or switched off). */
export function onHotkeyChange(listener: (active: string | null) => void): void {
  changed = listener
}
/** One filter for every key we register: a held hotkey repeats on Windows (see makePressFilter). */
let fresh = makePressFilter(repeatGapMs(null))

/** Returns false when the key is taken by another app or is not valid. */
export function registerHotkey(accelerator: string, onPress: () => void): boolean {
  unregisterHotkey()
  if (!isUsableHotkey(accelerator, process.platform)) return false
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, () => {
      const used = fresh()
      if (isTestMode()) console.log(`[instant] hotkey press ${used ? 'used' : 'ignored'}`)
      if (used) onPress()
    })
  } catch {
    ok = false // not a valid accelerator string
  }
  current = ok ? accelerator : null
  changed(current)
  return ok
}

export function unregisterHotkey(): void {
  if (!current) return
  globalShortcut.unregister(current)
  current = null
  changed(null)
}

/** The key that is switched on now, or null. */
export function activeHotkey(): string | null {
  return current
}

/** Fit the repeat filter to this PC's keyboard repeat delay. Windows only; quiet when the value cannot be read. */
export function readKeyboardRepeatDelay(): void {
  if (process.platform !== 'win32') return
  execFile('reg', ['query', 'HKCU\\Control Panel\\Keyboard', '/v', 'KeyboardDelay'], { windowsHide: true, timeout: 3000 }, (error, stdout) => {
    if (error) return
    fresh = makePressFilter(repeatGapMs(parseKeyboardDelay(String(stdout))))
  })
}
