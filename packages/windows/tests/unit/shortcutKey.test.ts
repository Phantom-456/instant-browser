import { expect, test } from 'vitest'
import { isShortcutKey } from '../../src/shared/shortcutKey'

const keys = (k: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }>) => ({ ctrlKey: false, metaKey: false, altKey: false, ...k })

test('Windows: Control starts a shortcut, the Windows key does not', () => {
  expect(isShortcutKey(keys({ ctrlKey: true }), 'win')).toBe(true)
  expect(isShortcutKey(keys({ metaKey: true }), 'win')).toBe(false)
})

test('Windows: AltGr (Control+Alt) types a character, so it is not a shortcut', () => {
  expect(isShortcutKey(keys({ ctrlKey: true, altKey: true }), 'win')).toBe(false)
})

test('Mac: Command starts a shortcut', () => {
  expect(isShortcutKey(keys({ metaKey: true }), 'mac')).toBe(true)
  expect(isShortcutKey(keys({ ctrlKey: true }), 'mac')).toBe(false)
})
