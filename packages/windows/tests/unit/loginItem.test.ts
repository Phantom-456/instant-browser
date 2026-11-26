import { expect, test } from 'vitest'
import { launchesAtLogin, loginItemSettings } from '../../src/shared/loginItem'

test('Windows: an app switched off in Startup apps does not count as opening at login', () => {
  expect(launchesAtLogin({ openAtLogin: true, executableWillLaunchAtLogin: false }, 'win32')).toBe(false)
  expect(launchesAtLogin({ openAtLogin: true, executableWillLaunchAtLogin: true }, 'win32')).toBe(true)
  expect(launchesAtLogin({ openAtLogin: false, executableWillLaunchAtLogin: false }, 'win32')).toBe(false)
})

test('without the Windows field, openAtLogin is the answer', () => {
  expect(launchesAtLogin({ openAtLogin: true }, 'win32')).toBe(true)
  expect(launchesAtLogin({ openAtLogin: true, executableWillLaunchAtLogin: false }, 'darwin')).toBe(true)
})

test('switching it on in Windows also clears a switch-off from Startup apps', () => {
  expect(loginItemSettings(true, 'win32')).toEqual({ openAtLogin: true, enabled: true })
  expect(loginItemSettings(false, 'win32')).toEqual({ openAtLogin: false, enabled: false })
  expect(loginItemSettings(true, 'darwin')).toEqual({ openAtLogin: true })
})
