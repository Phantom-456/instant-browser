import { expect, test } from 'vitest'
import { acceleratorFromKey, formatAccelerator } from '../../src/shared/accelerator'

const key = (code: string, mods: Partial<{ control: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}, k = '') => ({
  code, key: k, control: false, alt: false, shift: false, meta: false, ...mods
})

test('Command+Option+B on Mac', () => {
  expect(acceleratorFromKey(key('KeyB', { meta: true, alt: true }, 'ß'), 'darwin')).toEqual({
    status: 'done', accelerator: 'Alt+Command+B'
  })
})
test('Control+Alt+Space on Windows', () => {
  expect(acceleratorFromKey(key('Space', { control: true, alt: true }), 'win32')).toEqual({
    status: 'done', accelerator: 'Control+Alt+Space'
  })
  expect(acceleratorFromKey(key('Space', { alt: true, shift: true }), 'win32')).toEqual({
    status: 'done', accelerator: 'Alt+Shift+Space'
  })
})
test('the Windows key is refused on Windows: Electron would register the key without it', () => {
  const r = acceleratorFromKey(key('Digit7', { meta: true, shift: true }), 'win32')
  expect(r.status).toBe('invalid')
  expect(r).toMatchObject({ text: expect.stringContaining('Windows key') })
  expect(acceleratorFromKey(key('Space', { meta: true, control: true }), 'win32').status).toBe('invalid')
  // Windows key alone held: still waiting for the main key, nothing is refused yet.
  expect(acceleratorFromKey(key('MetaLeft', { meta: true }), 'win32').status).toBe('pending')
})
test('on Windows, Shift alone is not enough and the hint names Control or Alt', () => {
  expect(acceleratorFromKey(key('KeyB', { shift: true }), 'win32')).toEqual({ status: 'invalid', text: 'Hold Control or Alt together with the key.' })
})
test('function keys, arrows and punctuation', () => {
  expect(acceleratorFromKey(key('F5', { control: true }), 'darwin')).toMatchObject({ accelerator: 'Control+F5' })
  expect(acceleratorFromKey(key('ArrowUp', { alt: true }), 'darwin')).toMatchObject({ accelerator: 'Alt+Up' })
  expect(acceleratorFromKey(key('Slash', { meta: true }), 'darwin')).toMatchObject({ accelerator: 'Command+/' })
})
test('only modifiers pressed: keep waiting', () => {
  expect(acceleratorFromKey(key('MetaLeft', { meta: true }), 'darwin')).toEqual({ status: 'pending', text: 'Command+' })
  expect(acceleratorFromKey(key('AltLeft', { meta: true, alt: true }), 'darwin')).toEqual({ status: 'pending', text: 'Option+Command+' })
})
test('a key with no Control, Option or Command is refused', () => {
  expect(acceleratorFromKey(key('KeyB'), 'darwin').status).toBe('invalid')
  expect(acceleratorFromKey(key('KeyB', { shift: true }), 'darwin').status).toBe('invalid')
})
test('Escape alone cancels', () => {
  expect(acceleratorFromKey(key('Escape'), 'darwin').status).toBe('cancel')
})
test('unknown key is refused', () => {
  expect(acceleratorFromKey(key('MediaPlayPause', { control: true }), 'darwin').status).toBe('invalid')
})
test('falls back to the typed letter when there is no code', () => {
  expect(acceleratorFromKey(key('', { control: true }, 'b'), 'darwin')).toMatchObject({ accelerator: 'Control+B' })
})
test('display text uses the names of the keys on that system', () => {
  expect(formatAccelerator('Control+Alt+Space', 'darwin')).toBe('Control+Option+Space')
  expect(formatAccelerator('Alt+Command+B', 'darwin')).toBe('Option+Command+B')
  expect(formatAccelerator('Shift+Super+7', 'win32')).toBe('Shift+Windows+7')
  expect(formatAccelerator('CommandOrControl+B', 'win32')).toBe('Control+B')
})
