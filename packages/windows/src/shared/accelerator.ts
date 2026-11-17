/** One key press, as seen by Electron's `before-input-event` (or a browser keydown). */
export interface KeyPress {
  code: string
  key: string
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export type RecordResult =
  | { status: 'pending'; text: string } // only modifier keys so far
  | { status: 'invalid'; text: string } // show this message, keep listening
  | { status: 'cancel' }
  | { status: 'done'; accelerator: string }

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)$/

const NAMED: Record<string, string> = {
  Space: 'Space', Enter: 'Return', NumpadEnter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
  Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`'
}

/** The Electron key name for a physical key. The physical key is used so Option+B on Mac still gives "B". */
function keyName(code: string, typed: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]!
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]!
  const fn = /^F(\d{1,2})$/.exec(code)
  if (fn && Number(fn[1]) >= 1 && Number(fn[1]) <= 24) return code
  const pad = /^Numpad(\d)$/.exec(code)
  if (pad) return `num${pad[1]}`
  if (NAMED[code]) return NAMED[code]!
  if (!code && /^[a-z0-9]$/i.test(typed)) return typed.toUpperCase() // no physical code given
  return null
}

function modifierNames(press: KeyPress, platform: NodeJS.Platform): string[] {
  const names: string[] = []
  if (press.control) names.push('Control')
  if (press.alt) names.push('Alt')
  if (press.shift) names.push('Shift')
  if (press.meta) names.push(platform === 'darwin' ? 'Command' : 'Super')
  return names
}

/** Turn a key press into an Electron accelerator, or say what to do next. */
export function acceleratorFromKey(press: KeyPress, platform: NodeJS.Platform): RecordResult {
  const mods = modifierNames(press, platform)
  if (MODIFIER_CODES.test(press.code)) {
    return { status: 'pending', text: mods.length ? formatAccelerator(mods.join('+') + '+', platform) : '' }
  }
  if (press.code === 'Escape' && mods.length === 0) return { status: 'cancel' }
  const key = keyName(press.code, press.key)
  if (!key) return { status: 'invalid', text: 'This key cannot be used. Try another key.' }
  if (!press.control && !press.alt && !press.meta) {
    return {
      status: 'invalid',
      text: `Hold ${platform === 'darwin' ? 'Control, Option or Command' : 'Control, Alt or the Windows key'} together with the key.`
    }
  }
  return { status: 'done', accelerator: [...mods, key].join('+') }
}

/** The text shown to the user, with the names of the keys on that system. */
export function formatAccelerator(accelerator: string, platform: NodeJS.Platform): string {
  const mac = platform === 'darwin'
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl' || part === 'CmdOrCtrl') return mac ? 'Command' : 'Control'
      if (part === 'Alt' || part === 'Option') return mac ? 'Option' : 'Alt'
      if (part === 'Super' || part === 'Meta') return mac ? 'Command' : 'Windows'
      return part
    })
    .join('+')
}
