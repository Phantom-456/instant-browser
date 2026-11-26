// The key that starts app shortcuts in a page: Command on a Mac, Control elsewhere.
// On Windows the Windows key is not it (Windows+, and Windows+W belong to Windows), and Control+Alt is AltGr on many
// keyboards, which types characters, so it is not a shortcut either.

export interface ModifierState {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export function isShortcutKey(event: ModifierState, platform: 'mac' | 'win' | 'other'): boolean {
  if (platform === 'mac') return event.metaKey && !event.ctrlKey
  return event.ctrlKey && !event.metaKey && !event.altKey
}
