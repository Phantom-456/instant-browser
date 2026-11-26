export type HeldKey = 'shift' | 'control' | 'option' | 'command'

/**
 * Key combinations the user can choose. Hold them while clicking a link to open it in a mini window.
 * Windows: "option" is Alt. The Windows key ("command") is not offered: letting it go opens the Start menu.
 * A saved Mac combination with Command is not in this list, so it falls back to the default (Control+Alt).
 */
export const LINK_KEY_PRESETS: ReadonlyArray<{ id: string; label: string; keys: HeldKey[] }> = [
  { id: 'control+option', label: 'Control+Alt', keys: ['control', 'option'] },
  { id: 'option+shift', label: 'Alt+Shift', keys: ['option', 'shift'] },
  { id: 'control+shift', label: 'Control+Shift', keys: ['control', 'shift'] }
]

// The bits of macOS NSEvent.modifierFlags. The Windows key helper uses the same bits (Alt is option, the Windows key command).
const BITS: Record<HeldKey, number> = { shift: 1 << 17, control: 1 << 18, option: 1 << 19, command: 1 << 20 }

export function heldKeysFromMask(mask: number): HeldKey[] {
  return (Object.keys(BITS) as HeldKey[]).filter((key) => (mask & BITS[key]) !== 0)
}

/** True only when exactly the required keys are held. Holding more or other keys is a different gesture. */
export function keysAreHeld(required: readonly HeldKey[], mask: number): boolean {
  const held = heldKeysFromMask(mask)
  return held.length === required.length && required.every((key) => held.includes(key))
}

/** Terminals and code editors. A link that comes from one of them (for example from `gh auth login`) opens in a small window. */
export const TERMINAL_APPS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'com.apple.Terminal', name: 'Terminal' },
  { id: 'com.googlecode.iterm2', name: 'iTerm' },
  { id: 'dev.warp.Warp-Stable', name: 'Warp' },
  { id: 'dev.warp.Warp', name: 'Warp' },
  { id: 'com.mitchellh.ghostty', name: 'Ghostty' },
  { id: 'net.kovidgoyal.kitty', name: 'kitty' },
  { id: 'org.alacritty', name: 'Alacritty' },
  { id: 'com.github.wez.wezterm', name: 'WezTerm' },
  { id: 'co.zeit.hyper', name: 'Hyper' },
  { id: 'com.microsoft.VSCode', name: 'VS Code' },
  { id: 'com.microsoft.VSCodeInsiders', name: 'VS Code Insiders' },
  { id: 'com.todesktop.230313mzl4w4u92', name: 'Cursor' },
  // Windows: the process name in lower case.
  { id: 'windowsterminal', name: 'Windows Terminal' },
  { id: 'cmd', name: 'Command Prompt' },
  { id: 'powershell', name: 'Windows PowerShell' },
  { id: 'pwsh', name: 'PowerShell' },
  { id: 'conhost', name: 'Console' },
  { id: 'wezterm-gui', name: 'WezTerm' },
  { id: 'alacritty', name: 'Alacritty' },
  { id: 'warp', name: 'Warp' },
  { id: 'hyper', name: 'Hyper' },
  { id: 'code', name: 'VS Code' },
  { id: 'code - insiders', name: 'VS Code Insiders' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'windsurf', name: 'Windsurf' }
]

export function isTerminalApp(bundleId: string | null | undefined): boolean {
  return !!bundleId && TERMINAL_APPS.some((app) => app.id === bundleId)
}

export function decideRoute(input: {
  enabled: boolean
  isDefault: boolean
  required: readonly string[]
  /** null when the keys could not be read */
  mask: number | null
  hasMainBrowser: boolean
  /** The link comes from a terminal or a code editor, and the user wants those in a small window. */
  fromTerminal?: boolean
}): 'mini' | 'main' {
  // The router only works while Instant Browser is the default browser. Never lose a link: when in doubt, open it here.
  if (!input.enabled || !input.isDefault) return 'mini'
  if (input.fromTerminal) return 'mini'
  if (input.mask === null || !input.hasMainBrowser) return 'mini'
  return keysAreHeld(input.required as HeldKey[], input.mask) ? 'mini' : 'main'
}
