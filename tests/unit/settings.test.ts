import { expect, test } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/shared/settings'
import { SettingsFile } from '../../src/main/settingsFile'

test('bad input gives defaults', () => {
  expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS)
  expect(mergeSettings('x')).toEqual(DEFAULT_SETTINGS)
})
test('good values are kept, bad values fall back', () => {
  const s = mergeSettings({
    hotkey: 'Alt+Space',
    searchTemplate: 'https://no-placeholder.example',
    mainBrowserId: 'company.thebrowser.dia',
    alwaysOnTop: false,
    windowSize: { width: 10, height: 900 }
  })
  expect(s.hotkey).toBe('Alt+Space')
  expect(s.searchTemplate).toBe(DEFAULT_SETTINGS.searchTemplate)
  expect(s.mainBrowserId).toBe('company.thebrowser.dia')
  expect(s.alwaysOnTop).toBe(false)
  expect(s.windowSize).toEqual({ width: 320, height: 900 })
})
test('file: missing file gives defaults, update is saved', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ib-')), 'settings.json')
  const file = new SettingsFile(path)
  expect(file.get()).toEqual(DEFAULT_SETTINGS)
  file.update({ hotkey: 'Alt+Space' })
  expect(JSON.parse(readFileSync(path, 'utf8')).hotkey).toBe('Alt+Space')
  expect(new SettingsFile(path).get().hotkey).toBe('Alt+Space')
})
test('file: broken JSON gives defaults', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ib-')), 'settings.json')
  writeFileSync(path, '{not json')
  expect(new SettingsFile(path).get()).toEqual(DEFAULT_SETTINGS)
})

test('new fields have safe defaults and limits', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({
    launchAtLogin: false, defaultZoom: 1, httpsFirst: true, sendGpc: true,
    updateNotice: true, askDownloadLocation: true, downloadFolder: null
  })
  const s = mergeSettings({ defaultZoom: 9, httpsFirst: 'yes', downloadFolder: '/tmp/x', launchAtLogin: true })
  expect(s.defaultZoom).toBe(3)
  expect(s.httpsFirst).toBe(true)
  expect(s.downloadFolder).toBe('/tmp/x')
  expect(s.launchAtLogin).toBe(true)
})

test('suggestions are on by default and need a real boolean', () => {
  expect(DEFAULT_SETTINGS.showSuggestions).toBe(true)
  expect(mergeSettings({ showSuggestions: false }).showSuggestions).toBe(false)
  expect(mergeSettings({ showSuggestions: 'no' }).showSuggestions).toBe(true)
})

test('link router: on by default, key preset must be a known one', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ linkRouter: true, linkRouterKeys: 'option+command' })
  expect(mergeSettings({ linkRouterKeys: 'control+command' }).linkRouterKeys).toBe('control+command')
  expect(mergeSettings({ linkRouterKeys: 'nonsense' }).linkRouterKeys).toBe('option+command')
  expect(mergeSettings({ linkRouter: false }).linkRouter).toBe(false)
})

test('history: on by default, browsers can be turned off by name', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ showHistory: true, historyOff: [] })
  expect(mergeSettings({ showHistory: false }).showHistory).toBe(false)
  expect(mergeSettings({ historyOff: ['Arc', 4, ''] }).historyOff).toEqual(['Arc'])
})

test('warm window: on by default, needs a real boolean', () => {
  expect(DEFAULT_SETTINGS.warmWindow).toBe(true)
  expect(mergeSettings({ warmWindow: false }).warmWindow).toBe(false)
  expect(mergeSettings({ warmWindow: 'no' }).warmWindow).toBe(true)
})
