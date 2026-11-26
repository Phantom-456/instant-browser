import { formatAccelerator } from './accelerator'

/**
 * Which global hotkey to switch on at start.
 *
 * The first Windows default, Control+Alt+Space, was taken by another app on the Windows test PC (2026-11-15), so
 * the app started with no working hotkey. The default is now Control+Alt+B. A PC that still has the old default
 * saved moves to the new one. When the user never chose a key and the default is taken too, the app tries a
 * short list of other keys and keeps the first one that works. A key the user chose is never replaced.
 */
export const WINDOWS_FALLBACK_HOTKEYS: readonly string[] = ['Alt+Shift+Space', 'Control+Alt+Shift+Space']

/** Earlier Windows defaults. A saved one counts as "never chosen". */
export const OLD_WINDOWS_DEFAULTS: readonly string[] = ['Control+Alt+Space']

const neverChosen = (saved: string, defaultKey: string) => saved === defaultKey || OLD_WINDOWS_DEFAULTS.includes(saved)

export interface HotkeyChoice {
  /** The key that is now active, or null when none could be registered. */
  active: string | null
  /** True when the active key is not the saved one (it should be saved and the user told). */
  fellBack: boolean
  /** Every key that was tried, in order. */
  tried: string[]
}

export function hotkeyCandidates(saved: string, defaultKey: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32' || !neverChosen(saved, defaultKey)) return [saved]
  return [defaultKey, ...WINDOWS_FALLBACK_HOTKEYS.filter((k) => k !== defaultKey)]
}

/** `register` returns true when the key was switched on. It is called once per candidate until one works. */
export function chooseHotkey(
  saved: string,
  defaultKey: string,
  platform: NodeJS.Platform,
  register: (accelerator: string) => boolean
): HotkeyChoice {
  const tried: string[] = []
  for (const key of hotkeyCandidates(saved, defaultKey, platform)) {
    tried.push(key)
    if (register(key)) return { active: key, fellBack: key !== saved, tried }
  }
  return { active: null, fellBack: false, tried }
}

/** The text of the notification shown at start, or null when nothing needs saying. */
export function hotkeyNotice(choice: HotkeyChoice, saved: string, shown: (accelerator: string) => string, defaultKey?: string): string | null {
  if (choice.active && !choice.fellBack) return null
  if (choice.active && choice.active === defaultKey && OLD_WINDOWS_DEFAULTS.includes(saved)) {
    return `The hotkey for the search bar is now ${shown(choice.active)}. You can change it in Settings.`
  }
  if (choice.active) {
    return `${shown(choice.tried[0] ?? saved)} is used by another app, so the search bar opens with ${shown(choice.active)}. You can change it in Settings.`
  }
  const tried = choice.tried[0] ?? saved
  return `The hotkey ${shown(tried)} is used by another app. Open Settings from the tray menu to choose another key.`
}

/**
 * Electron registers global keys on Windows with RegisterHotKey and no MOD_NOREPEAT (Chromium
 * global_accelerator_listener_win.cc), so a held hotkey arrives again at the keyboard repeat rate, and each
 * repeat would open or close the bar. Presses closer together than the gap are one press. The gap is a
 * little longer than the user's keyboard repeat delay, so the first repeat of a held key is caught too.
 */
export function makePressFilter(gapMs: number, now: () => number = Date.now): () => boolean {
  let last = -Infinity
  return () => {
    const t = now()
    const fresh = t - last >= gapMs
    last = t // a held key keeps pushing this forward, so a long hold counts once
    return fresh
  }
}

/**
 * The gap for `makePressFilter`. `keyboardDelay` is the Windows setting "Repeat delay" (0 to 3, in steps of
 * about 250 ms, registry HKCU\Control Panel\Keyboard\KeyboardDelay). Unknown values use the Windows default (1).
 */
export function repeatGapMs(keyboardDelay: number | null): number {
  const d = keyboardDelay !== null && Number.isInteger(keyboardDelay) && keyboardDelay >= 0 && keyboardDelay <= 3 ? keyboardDelay : 1
  return (d + 1) * 250 + 150
}

/** Reads the value out of `reg query "HKCU\Control Panel\Keyboard" /v KeyboardDelay`. */
export function parseKeyboardDelay(regOutput: string): number | null {
  const m = /KeyboardDelay\s+REG_\w+\s+(\S+)/i.exec(regOutput)
  if (!m) return null
  const n = m[1]!.toLowerCase().startsWith('0x') ? parseInt(m[1]!, 16) : Number(m[1])
  return Number.isInteger(n) ? n : null
}

/**
 * Chromium drops the Windows key when it registers a global key on Windows (it only maps Shift, Control and
 * Alt), so "Super+Space" would quietly take plain Space from every app. Keys with the Windows key are refused.
 */
export function isUsableHotkey(accelerator: string, platform: NodeJS.Platform): boolean {
  if (!accelerator) return false
  if (platform !== 'win32') return true
  return !accelerator.split('+').some((part) => /^(Super|Meta|Command|Cmd)$/i.test(part))
}

/**
 * The tray icon's tooltip. On Windows the tray is the only visible sign of the app, so it names the hotkey.
 * Windows cuts tooltips at 127 characters.
 */
export function trayTooltip(active: string | null, platform: NodeJS.Platform): string {
  if (!active) return 'Instant Browser'
  return `Instant Browser\n${formatAccelerator(active, platform)} opens the search bar`.slice(0, 127)
}
