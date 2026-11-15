export type HeldKey = 'shift' | 'control' | 'option' | 'command'

/** Key combinations the user can choose. Hold them while clicking a link to open it in a mini window. */
export const LINK_KEY_PRESETS: ReadonlyArray<{ id: string; label: string; keys: HeldKey[] }> = [
  { id: 'option+command', label: 'Option+Command', keys: ['option', 'command'] },
  { id: 'control+command', label: 'Control+Command', keys: ['control', 'command'] },
  { id: 'option+shift', label: 'Option+Shift', keys: ['option', 'shift'] },
  { id: 'control+option', label: 'Control+Option', keys: ['control', 'option'] }
]

// The bits of macOS NSEvent.modifierFlags.
const BITS: Record<HeldKey, number> = { shift: 1 << 17, control: 1 << 18, option: 1 << 19, command: 1 << 20 }

export function heldKeysFromMask(mask: number): HeldKey[] {
  return (Object.keys(BITS) as HeldKey[]).filter((key) => (mask & BITS[key]) !== 0)
}

/** True only when exactly the required keys are held. Holding more or other keys is a different gesture. */
export function keysAreHeld(required: readonly HeldKey[], mask: number): boolean {
  const held = heldKeysFromMask(mask)
  return held.length === required.length && required.every((key) => held.includes(key))
}

export function decideRoute(input: {
  enabled: boolean
  isDefault: boolean
  required: readonly string[]
  /** null when the keys could not be read */
  mask: number | null
  hasMainBrowser: boolean
}): 'mini' | 'main' {
  // The router only works while Instant Browser is the default browser. Never lose a link: when in doubt, open it here.
  if (!input.enabled || !input.isDefault) return 'mini'
  if (input.mask === null || !input.hasMainBrowser) return 'mini'
  return keysAreHeld(input.required as HeldKey[], input.mask) ? 'mini' : 'main'
}
