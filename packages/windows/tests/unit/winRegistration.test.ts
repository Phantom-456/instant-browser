import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  WIN_BROWSER_NAME, WIN_CAPABILITIES_KEY, WIN_CLIENT_KEY, WIN_DEFAULT_APPS_URL, WIN_URL_PROG_ID, isOurDefault, parseUserChoiceProgId, userChoiceKey
} from '../../src/shared/winRegistration'

const nsh = readFileSync('build/installer.nsh', 'utf8')
const builder = readFileSync('electron-builder.yml', 'utf8')

test('the installer includes the registration script', () => {
  expect(builder).toMatch(/^\s+include: build\/installer\.nsh$/m)
  expect(nsh).toContain('!macro customInstall')
  expect(nsh).toContain('!macro customUnInstall')
})
test('the installer writes the names the app looks for', () => {
  expect(nsh).toContain(`"Software\\Classes\\${WIN_URL_PROG_ID}\\shell\\open\\command" "" '"$appExe" --single-argument %1'`)
  expect(nsh).toContain(`"${WIN_CAPABILITIES_KEY}\\URLAssociations" "http" "${WIN_URL_PROG_ID}"`)
  expect(nsh).toContain(`"${WIN_CAPABILITIES_KEY}\\URLAssociations" "https" "${WIN_URL_PROG_ID}"`)
  expect(nsh).toContain(`"Software\\RegisteredApplications" "${WIN_BROWSER_NAME}" "${WIN_CAPABILITIES_KEY}"`)
})
test('uninstall removes every key it wrote', () => {
  const uninstall = nsh.slice(nsh.indexOf('!macro customUnInstall'))
  expect(uninstall).toContain(`DeleteRegValue HKCU "Software\\RegisteredApplications" "${WIN_BROWSER_NAME}"`)
  expect(uninstall).toContain(`DeleteRegKey HKCU "${WIN_CLIENT_KEY}"`)
  expect(uninstall).toContain(`DeleteRegKey HKCU "Software\\Classes\\${WIN_URL_PROG_ID}"`)
})
test('the browser name matches the product name, so the app does not list itself as a browser to send to', () => {
  expect(builder).toMatch(new RegExp(`^productName: ${WIN_BROWSER_NAME}$`, 'm'))
})
test('reads the user choice from reg query output', () => {
  const out = `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice\r\n    ProgId    REG_SZ    InstantBrowserURL\r\n\r\n`
  expect(parseUserChoiceProgId(out)).toBe('InstantBrowserURL')
  expect(parseUserChoiceProgId('    ProgId    REG_SZ    ChromeHTML')).toBe('ChromeHTML')
  expect(parseUserChoiceProgId('ERROR: The system was unable to find the specified registry key or value.')).toBeNull()
  expect(userChoiceKey('http')).toBe('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice')
})
test('default only when both http and https are ours', () => {
  expect(isOurDefault(WIN_URL_PROG_ID, WIN_URL_PROG_ID)).toBe(true)
  expect(isOurDefault(WIN_URL_PROG_ID, 'ChromeHTML')).toBe(false)
  expect(isOurDefault(null, null)).toBe(false)
})
test('Default apps opens on this app', () => {
  expect(WIN_DEFAULT_APPS_URL).toBe('ms-settings:defaultapps?registeredAppUser=Instant%20Browser')
})
test('no link command passes the address in a way that lets it add switches', () => {
  for (const line of nsh.split('\n').filter((l) => l.includes('%1') && !l.trim().startsWith(';'))) {
    expect(line).toContain('--single-argument %1')
    expect(line).not.toContain('"%1"')
  }
})
