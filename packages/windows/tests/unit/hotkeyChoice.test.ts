import { expect, test } from 'vitest'
import {
  OLD_WINDOWS_DEFAULTS, WINDOWS_FALLBACK_HOTKEYS, chooseHotkey, hotkeyCandidates, hotkeyNotice, isUsableHotkey, makePressFilter, parseKeyboardDelay, repeatGapMs, trayTooltip } from '../../src/shared/hotkeyChoice'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { formatAccelerator } from '../../src/shared/accelerator'

const DEFAULT = DEFAULT_SETTINGS.hotkey
const shown = (a: string) => formatAccelerator(a, 'win32')

test('the Windows default is Control+Alt+B (Control+Alt+Space was taken on the test PC)', () => {
  expect(DEFAULT).toBe('Control+Alt+B')
  expect(OLD_WINDOWS_DEFAULTS).toContain('Control+Alt+Space')
})
test('a PC with the old default saved moves to the new default, and is told once', () => {
  expect(hotkeyCandidates('Control+Alt+Space', DEFAULT, 'win32')).toEqual([DEFAULT, ...WINDOWS_FALLBACK_HOTKEYS])
  const choice = chooseHotkey('Control+Alt+Space', DEFAULT, 'win32', () => true)
  expect(choice).toEqual({ active: DEFAULT, fellBack: true, tried: [DEFAULT] })
  expect(hotkeyNotice(choice, 'Control+Alt+Space', shown, DEFAULT)).toBe('The hotkey for the search bar is now Control+Alt+B. You can change it in Settings.')
})
test('old default saved and the new default taken: a fallback, and the message names the taken key', () => {
  const choice = chooseHotkey('Control+Alt+Space', DEFAULT, 'win32', (k) => k !== DEFAULT)
  expect(choice.active).toBe('Alt+Shift+Space')
  expect(hotkeyNotice(choice, 'Control+Alt+Space', shown, DEFAULT)).toBe(
    'Control+Alt+B is used by another app, so the search bar opens with Alt+Shift+Space. You can change it in Settings.'
  )
})
test('the default key is tried first, then the Windows fallbacks', () => {
  expect(hotkeyCandidates(DEFAULT, DEFAULT, 'win32')).toEqual([DEFAULT, ...WINDOWS_FALLBACK_HOTKEYS])
})
test('a key the user chose is never replaced', () => {
  expect(hotkeyCandidates('Control+Alt+K', DEFAULT, 'win32')).toEqual(['Control+Alt+K'])
  expect(hotkeyCandidates('Alt+Shift+Space', DEFAULT, 'win32')).toEqual(['Alt+Shift+Space'])
})
test('no fallbacks off Windows', () => {
  expect(hotkeyCandidates(DEFAULT, DEFAULT, 'darwin')).toEqual([DEFAULT])
})
test('fallbacks are usable Windows keys and none repeats the default', () => {
  for (const k of WINDOWS_FALLBACK_HOTKEYS) {
    expect(isUsableHotkey(k, 'win32')).toBe(true)
    expect(k).not.toBe(DEFAULT)
  }
})

test('the default is free: it is used and nothing is said', () => {
  const choice = chooseHotkey(DEFAULT, DEFAULT, 'win32', () => true)
  expect(choice).toEqual({ active: DEFAULT, fellBack: false, tried: [DEFAULT] })
  expect(hotkeyNotice(choice, DEFAULT, shown)).toBeNull()
})
test('the default is taken (seen on a Windows 11 PC): the first free fallback is used and the user is told', () => {
  const taken = new Set([DEFAULT])
  const choice = chooseHotkey(DEFAULT, DEFAULT, 'win32', (k) => !taken.has(k))
  expect(choice).toEqual({ active: 'Alt+Shift+Space', fellBack: true, tried: [DEFAULT, 'Alt+Shift+Space'] })
  expect(hotkeyNotice(choice, DEFAULT, shown)).toBe(
    'Control+Alt+B is used by another app, so the search bar opens with Alt+Shift+Space. You can change it in Settings.'
  )
})
test('every key is taken: no key, and the old message', () => {
  const choice = chooseHotkey(DEFAULT, DEFAULT, 'win32', () => false)
  expect(choice.active).toBeNull()
  expect(choice.tried).toEqual([DEFAULT, ...WINDOWS_FALLBACK_HOTKEYS])
  expect(hotkeyNotice(choice, DEFAULT, shown)).toMatch(/^The hotkey Control\+Alt\+B is used by another app/)
})
test('a chosen key that is taken is not swapped for another', () => {
  const choice = chooseHotkey('Control+Alt+K', DEFAULT, 'win32', () => false)
  expect(choice).toEqual({ active: null, fellBack: false, tried: ['Control+Alt+K'] })
})

test('keys with the Windows key are not usable on Windows, but are on Mac', () => {
  expect(isUsableHotkey('Super+Space', 'win32')).toBe(false)
  expect(isUsableHotkey('Shift+Meta+7', 'win32')).toBe(false)
  expect(isUsableHotkey('Command+Space', 'win32')).toBe(false)
  expect(isUsableHotkey('CommandOrControl+Space', 'win32')).toBe(true) // this is Control on Windows
  expect(isUsableHotkey('Control+Alt+Space', 'win32')).toBe(true)
  expect(isUsableHotkey('Alt+Command+B', 'darwin')).toBe(true)
  expect(isUsableHotkey('', 'win32')).toBe(false)
})

test('a held hotkey counts once: Windows repeats come at the repeat delay, then about every 33 ms', () => {
  let t = 0
  const fresh = makePressFilter(repeatGapMs(1), () => t)
  const seen: boolean[] = []
  for (const at of [0, 500, 533, 566, 600, 633]) { t = at; seen.push(fresh()) }
  expect(seen).toEqual([true, false, false, false, false, false])
  t = 633 + 900 // let go, then press again later
  expect(fresh()).toBe(true)
})
test('the longest repeat delay (3, about 1 second) is still caught', () => {
  let t = 0
  const fresh = makePressFilter(repeatGapMs(3), () => t)
  expect(fresh()).toBe(true)
  t = 1000
  expect(fresh()).toBe(false)
})
test('two separate presses a normal distance apart both count', () => {
  let t = 0
  const fresh = makePressFilter(repeatGapMs(0), () => t)
  expect(fresh()).toBe(true)
  t = 600
  expect(fresh()).toBe(true)
})
test('repeat gap follows the Windows setting and falls back to the default', () => {
  expect(repeatGapMs(0)).toBe(400)
  expect(repeatGapMs(1)).toBe(650)
  expect(repeatGapMs(3)).toBe(1150)
  expect(repeatGapMs(null)).toBe(650)
  expect(repeatGapMs(9)).toBe(650)
})
test('reads KeyboardDelay from reg query output', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Control Panel\\Keyboard\r\n    KeyboardDelay    REG_SZ    1\r\n\r\n'
  expect(parseKeyboardDelay(out)).toBe(1)
  expect(parseKeyboardDelay('    KeyboardDelay    REG_DWORD    0x3')).toBe(3)
  expect(parseKeyboardDelay('ERROR: The system was unable to find the specified registry key or value.')).toBeNull()
})

test('the tray tooltip names the hotkey in Windows words', () => {
  expect(trayTooltip('Control+Alt+B', 'win32')).toBe('Instant Browser\nControl+Alt+B opens the search bar')
  expect(trayTooltip('CommandOrControl+Shift+Space', 'win32')).toBe('Instant Browser\nControl+Shift+Space opens the search bar')
  expect(trayTooltip(null, 'win32')).toBe('Instant Browser') // no working hotkey: nothing to promise
  expect(trayTooltip('Control+Alt+Shift+'.repeat(20) + 'B', 'win32').length).toBeLessThanOrEqual(127) // the Windows limit
})
