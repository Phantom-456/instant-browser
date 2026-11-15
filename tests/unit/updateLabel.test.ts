import { expect, test } from 'vitest'
import { updateLabel } from '../../src/shared/updateLabel'

test('each update state has a short plain text', () => {
  expect(updateLabel({ status: 'disabled', current: '0.2.0' })).toMatch(/only in the installed app/i)
  expect(updateLabel({ status: 'idle', current: '0.2.0' })).toBe('Version 0.2.0. Up to date.')
  expect(updateLabel({ status: 'checking', current: '0.2.0' })).toBe('Checking for updates...')
  expect(updateLabel({ status: 'downloading', current: '0.2.0', version: '0.3.0' })).toBe('Downloading version 0.3.0...')
  expect(updateLabel({ status: 'ready', current: '0.2.0', version: '0.3.0' })).toBe('Version 0.3.0 is ready. Restart to install it.')
  expect(updateLabel({ status: 'error', current: '0.2.0', message: 'boom' })).toBe('Could not check for updates. boom')
})
test('no em dashes in any text', () => {
  for (const status of ['disabled', 'idle', 'checking', 'downloading', 'ready', 'error'] as const) {
    expect(updateLabel({ status, current: '1.0.0', version: '2.0.0', message: 'x' })).not.toMatch(/—/)
  }
})
