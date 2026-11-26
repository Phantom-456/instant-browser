/** Turns an Electron accelerator ("Alt+Command+B") into what a key listener sees, and matches key presses against it. */

export interface HotkeyShape {
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  /** The key name, upper case for letters ("B", "SPACE", "F5"). */
  key: string
}

const ALIASES: Record<string, keyof Omit<HotkeyShape, 'key'>> = {
  control: 'control', ctrl: 'control',
  alt: 'alt', option: 'alt',
  shift: 'shift',
  command: 'meta', cmd: 'meta', super: 'meta', meta: 'meta',
  commandorcontrol: 'meta', cmdorctrl: 'meta' // this listener is for the Mac
}

const KEY_ALIASES: Record<string, string> = { RETURN: 'ENTER', ESC: 'ESCAPE', UP: 'ARROWUP', DOWN: 'ARROWDOWN', LEFT: 'ARROWLEFT', RIGHT: 'ARROWRIGHT', PLUS: '=' }

export function parseAccelerator(accelerator: string): HotkeyShape | null {
  const shape: HotkeyShape = { control: false, alt: false, shift: false, meta: false, key: '' }
  const parts = accelerator.split('+')
  // A key that is "+" itself ends the string with an empty part; it is not supported.
  for (const raw of parts) {
    const part = raw.trim()
    if (!part) return null
    const mod = ALIASES[part.toLowerCase()]
    if (mod) shape[mod] = true
    else if (shape.key) return null // two keys
    else shape.key = KEY_ALIASES[part.toUpperCase()] ?? part.toUpperCase()
  }
  return shape.key && (shape.control || shape.alt || shape.meta) ? shape : null
}

/** The key name for a uiohook key table entry ("B", "Space", "ArrowUp") in the same form as HotkeyShape.key. */
export function keyNameOf(table: Record<string, number>, keycode: number): string | null {
  for (const [name, code] of Object.entries(table)) {
    if (code === keycode && !/^(Ctrl|Alt|Shift|Meta)/.test(name) && !name.startsWith('Numpad')) return name.toUpperCase()
  }
  return null
}

export interface KeyEventLike { keycode: number; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

export function matches(shape: HotkeyShape, e: KeyEventLike, table: Record<string, number>): boolean {
  return (
    e.ctrlKey === shape.control && e.altKey === shape.alt && e.shiftKey === shape.shift && e.metaKey === shape.meta &&
    keyNameOf(table, e.keycode) === shape.key
  )
}
