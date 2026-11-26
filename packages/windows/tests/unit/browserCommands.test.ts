import { expect, test } from 'vitest'
import {
  exePathFromCommand,
  openCommand,
  parseRegDefaultValue,
  parseRegSubkeys,
  pickMainBrowser
} from '../../src/shared/browserCommands'

const dia = { id: 'company.thebrowser.dia', name: 'Dia' }
const edgeWin = { id: 'Microsoft Edge', name: 'Microsoft Edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' }

test('mac opens by bundle id', () => {
  expect(openCommand('darwin', dia, 'https://example.com')).toEqual({
    cmd: 'open',
    args: ['-b', 'company.thebrowser.dia', 'https://example.com']
  })
})
test('windows runs the browser exe with the URL', () => {
  expect(openCommand('win32', edgeWin, 'https://example.com')).toEqual({
    cmd: edgeWin.path,
    args: ['https://example.com']
  })
})
test('non-web URLs and missing paths give null', () => {
  expect(openCommand('darwin', dia, 'file:///etc/passwd')).toBeNull()
  expect(openCommand('win32', { id: 'x', name: 'x' }, 'https://example.com')).toBeNull()
  expect(openCommand('linux', dia, 'https://example.com')).toBeNull()
})
test('registry subkeys are read', () => {
  const out = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Google Chrome',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Microsoft Edge',
    ''
  ].join('\r\n')
  expect(parseRegSubkeys(out)).toEqual(['Google Chrome', 'Microsoft Edge'])
})
test('registry default value is read', () => {
  const out = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Google Chrome\\shell\\open\\command',
    '    (Default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
    ''
  ].join('\r\n')
  expect(parseRegDefaultValue(out)).toBe('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"')
  expect(parseRegDefaultValue('ERROR: not found')).toBeNull()
})
test('exe path is taken out of a command line', () => {
  expect(exePathFromCommand('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"')).toBe(
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  )
  expect(exePathFromCommand('C:\\Apps\\zen.exe -osint -url "%1"')).toBe('C:\\Apps\\zen.exe')
  expect(exePathFromCommand('')).toBeNull()
})
test('main browser: the wanted one, else the first', () => {
  const all = [{ id: 'a', name: 'A' }, dia]
  expect(pickMainBrowser(all, 'company.thebrowser.dia')).toEqual(dia)
  expect(pickMainBrowser(all, 'gone')).toEqual({ id: 'a', name: 'A' })
  expect(pickMainBrowser([], null)).toBeNull()
})

import { urlsFromArgv } from '../../src/shared/browserCommands'

test('web URLs are taken from command line arguments', () => {
  expect(urlsFromArgv(['C:\\Apps\\Instant Browser.exe', '--flag', 'https://example.com/a', 'file:///x', 'notes.txt'])).toEqual([
    'https://example.com/a'
  ])
  expect(urlsFromArgv([])).toEqual([])
})
test('a link started by Windows (--single-argument) is one address, even with a quote in it', () => {
  // Default apps runs: "Instant Browser.exe" --single-argument <link>. Chromium keeps the link as one argument.
  expect(urlsFromArgv(['C:\\Apps\\Instant Browser.exe', '--single-argument', 'https://example.com/a?b=1'])).toEqual(['https://example.com/a?b=1'])
  const crafted = 'https://example.invalid/" --user-data-dir="C:\\x'
  const found = urlsFromArgv(['C:\\Apps\\Instant Browser.exe', '--single-argument', crafted])
  expect(found.length).toBeLessThanOrEqual(1) // never split into a second argument
  expect(found.every((u) => u.startsWith('https://example.invalid/'))).toBe(true)
})
