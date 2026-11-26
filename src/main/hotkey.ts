import { globalShortcut } from 'electron'
import { keyListenerActive, startKeyListener, stopKeyListener } from './keyListener'

let current: string | null = null

/**
 * Returns false when the key is taken by another app or is not valid.
 * With share on (Mac), the key is only watched, so the app in front still gets it. If macOS has not allowed that,
 * the normal hotkey is used.
 */
export function registerHotkey(accelerator: string, onPress: () => void, share = false): boolean {
  unregisterHotkey()
  if (share && process.platform === 'darwin' && startKeyListener(accelerator, onPress)) {
    current = null
    return true
  }
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, onPress)
  } catch {
    ok = false // not a valid accelerator string
  }
  current = ok ? accelerator : null
  return ok
}

export function unregisterHotkey(): void {
  if (current) globalShortcut.unregister(current)
  current = null
  stopKeyListener()
}

/** True while the hotkey is only watched (the other app keeps the key too). */
export function hotkeyShared(): boolean { return keyListenerActive() }
