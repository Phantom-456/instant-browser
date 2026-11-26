import { systemPreferences } from 'electron'
import { parseAccelerator, matches, keyNameOf } from '../shared/hotkeyMatch'

/**
 * Watches the keyboard without taking the key from other apps (Mac only), so the hotkey opens the search bar and the app in front
 * still gets the key. The normal hotkey (Electron globalShortcut) takes the key for itself, and it cannot work for a key that
 * another app has already taken. This needs the Accessibility permission, so it is only used when the user turns it on.
 */
type KeyEvent = { keycode: number; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }
type KeyFn = (e: KeyEvent) => void
interface Hook {
  on: (event: 'keydown' | 'keyup', fn: KeyFn) => void
  off: (event: string, fn: KeyFn) => void
  start: () => void
  stop: () => void
}

let hook: Hook | null = null
let onDown: KeyFn | null = null
let onUp: KeyFn | null = null

/** True when macOS lets Talaria watch keys. With prompt, macOS shows its permission window the first time. */
export function keyListenerAllowed(prompt: boolean): boolean {
  if (process.platform !== 'darwin') return false
  try { return systemPreferences.isTrustedAccessibilityClient(prompt) } catch { return false }
}

export function startKeyListener(accelerator: string, onPress: () => void): boolean {
  stopKeyListener()
  const shape = parseAccelerator(accelerator)
  if (!shape || !keyListenerAllowed(true)) return false
  try {
    const mod = require('uiohook-napi') as { uIOhook: Hook; UiohookKey: Record<string, number> }
    const table = mod.UiohookKey
    let held = false // the key repeats while held; open once per press
    onDown = (e) => {
      if (held || !matches(shape, e, table)) return
      held = true
      onPress()
    }
    onUp = (e) => { if (keyNameOf(table, e.keycode) === shape.key) held = false }
    mod.uIOhook.on('keydown', onDown)
    mod.uIOhook.on('keyup', onUp)
    mod.uIOhook.start()
    hook = mod.uIOhook
    return true
  } catch {
    stopKeyListener()
    return false
  }
}

export function stopKeyListener(): void {
  if (hook) {
    try { if (onDown) hook.off('keydown', onDown); if (onUp) hook.off('keyup', onUp); hook.stop() } catch { /* already stopped */ }
  }
  hook = null; onDown = null; onUp = null
}

export function keyListenerActive(): boolean { return hook !== null }
