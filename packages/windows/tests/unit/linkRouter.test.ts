import { expect, test } from 'vitest'
import { LINK_KEY_PRESETS, decideRoute, heldKeysFromMask, keysAreHeld } from '../../src/shared/linkRouter'

// Mac modifier bits: shift 1<<17, control 1<<18, option 1<<19, command 1<<20.
const OPTION = 1 << 19
const COMMAND = 1 << 20
const SHIFT = 1 << 17

test('held keys are read from the mac mask', () => {
  expect(heldKeysFromMask(0)).toEqual([])
  expect(heldKeysFromMask(OPTION | COMMAND).sort()).toEqual(['command', 'option'])
  expect(heldKeysFromMask(SHIFT)).toEqual(['shift'])
})
test('all required keys must be held, and no others', () => {
  expect(keysAreHeld(['option', 'command'], OPTION | COMMAND)).toBe(true)
  expect(keysAreHeld(['option', 'command'], OPTION)).toBe(false)
  expect(keysAreHeld(['option', 'command'], OPTION | COMMAND | SHIFT)).toBe(false) // a different combination
  expect(keysAreHeld(['option', 'command'], 0)).toBe(false)
})
test('the route: mini window only for the key combination, otherwise the main browser', () => {
  const base = { enabled: true, isDefault: true, required: ['option', 'command'] as const, mask: 0, hasMainBrowser: true }
  expect(decideRoute({ ...base, required: [...base.required], mask: OPTION | COMMAND })).toBe('mini')
  expect(decideRoute({ ...base, required: [...base.required], mask: 0 })).toBe('main')
})
test('router is off unless Instant Browser is the default browser and the setting is on', () => {
  const base = { required: ['option', 'command'], mask: 0, hasMainBrowser: true }
  expect(decideRoute({ ...base, enabled: true, isDefault: false })).toBe('mini')
  expect(decideRoute({ ...base, enabled: false, isDefault: true })).toBe('mini')
})
test('never lose a link: no way to read keys, or no main browser, opens a mini window', () => {
  const on = { enabled: true, isDefault: true, required: ['option', 'command'] }
  expect(decideRoute({ ...on, mask: null, hasMainBrowser: true })).toBe('mini')
  expect(decideRoute({ ...on, mask: 0, hasMainBrowser: false })).toBe('mini')
})
test('presets have a Windows label and at least one key', () => {
  const names = { control: 'Control', option: 'Alt', shift: 'Shift', command: 'Windows' } as const
  for (const preset of LINK_KEY_PRESETS) {
    expect(preset.keys.length).toBeGreaterThan(0)
    expect(preset.label).toBe(preset.keys.map((k) => names[k]).join('+'))
    expect(preset.id).toBe(preset.keys.join('+'))
  }
})
test('no preset needs the Windows key: letting it go opens the Start menu', () => {
  for (const preset of LINK_KEY_PRESETS) expect(preset.keys).not.toContain('command')
})
