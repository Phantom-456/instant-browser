import { globalShortcut } from 'electron'

let current: string | null = null

/** Returns false when the key is taken by another app or is not valid. */
export function registerHotkey(accelerator: string, onPress: () => void): boolean {
  unregisterHotkey()
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
}
