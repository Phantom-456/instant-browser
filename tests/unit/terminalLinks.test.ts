import { expect, test } from 'vitest'
import { TERMINAL_APPS, decideRoute, isTerminalApp } from '../../src/shared/linkRouter'
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/shared/settings'

const on = { enabled: true, isDefault: true, required: ['option', 'command'], mask: 0, hasMainBrowser: true }

test('terminals and code editors are known by their bundle id', () => {
  for (const id of ['com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable', 'com.mitchellh.ghostty', 'com.microsoft.VSCode']) {
    expect(isTerminalApp(id)).toBe(true)
  }
  for (const id of ['com.apple.Safari', 'com.microsoft.teams2', null, '']) expect(isTerminalApp(id)).toBe(false)
  expect(TERMINAL_APPS.length).toBeGreaterThanOrEqual(8)
})

test('a link that comes from a terminal opens in a small window, with no keys held', () => {
  expect(decideRoute({ ...on, fromTerminal: true })).toBe('mini')
  expect(decideRoute({ ...on, fromTerminal: false })).toBe('main')
  expect(decideRoute({ ...on })).toBe('main')
})

test('the terminal rule does not apply when the router is off or the app is not the default', () => {
  expect(decideRoute({ ...on, enabled: false, fromTerminal: true })).toBe('mini') // always a small window then, as before
  expect(decideRoute({ ...on, isDefault: false, fromTerminal: true })).toBe('mini')
})

test('the setting is on by default and needs a real boolean', () => {
  expect(DEFAULT_SETTINGS.terminalLinksSmallWindow).toBe(true)
  expect(mergeSettings({ terminalLinksSmallWindow: false }).terminalLinksSmallWindow).toBe(false)
  expect(mergeSettings({ terminalLinksSmallWindow: 'no' }).terminalLinksSmallWindow).toBe(true)
})
