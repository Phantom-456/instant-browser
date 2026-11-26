import { expect, test } from 'vitest'
import { historySources, isChromiumProfileDir } from '../../src/shared/historyPaths'

test('mac: every browser has a history folder inside Application Support, and nothing else', () => {
  const list = historySources('darwin', '/Users/x', {})
  expect(list.map((s) => s.name)).toEqual(['Dia', 'Arc', 'Google Chrome', 'Microsoft Edge', 'Brave', 'Firefox', 'Zen'])
  for (const s of list) expect(s.dir.startsWith('/Users/x/Library/Application Support/')).toBe(true)
  expect(list.find((s) => s.name === 'Zen')?.kind).toBe('firefox')
})
test('windows: uses the AppData folders', () => {
  const list = historySources('win32', 'C:\\Users\\x', { LOCALAPPDATA: 'D:\\L', APPDATA: 'D:\\R' })
  expect(list.map((s) => s.name)).toEqual(['Google Chrome', 'Microsoft Edge', 'Brave', 'Firefox'])
  expect(list[0]?.dir).toContain('D:\\L')
})
test('other systems have no sources', () => {
  expect(historySources('linux', '/home/x', {})).toEqual([])
})
test('chromium profile folders', () => {
  for (const ok of ['Default', 'Profile 1', 'Profile 12']) expect(isChromiumProfileDir(ok)).toBe(true)
  for (const no of ['Guest Profile', 'System Profile', 'Profile', 'Cache']) expect(isChromiumProfileDir(no)).toBe(false)
})
