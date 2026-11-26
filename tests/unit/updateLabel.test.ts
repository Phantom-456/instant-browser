import { expect, test } from 'vitest'
import { canSkip, isSkipped, problemReportUrl, releaseNotesUrl, updateLabel } from '../../src/shared/updateLabel'

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

test('a skipped version is named in the label', () => {
  expect(updateLabel({ status: 'skipped', current: '0.3.0', version: '0.3.1' })).toBe('Version 0.3.0. You skipped version 0.3.1.')
})

test('isSkipped ignores a leading v and spaces', () => {
  expect(isSkipped('0.3.1', ['0.3.1'])).toBe(true)
  expect(isSkipped('0.3.1', [' v0.3.1 '])).toBe(true)
  expect(isSkipped('0.3.2', ['0.3.1'])).toBe(false)
  expect(isSkipped(undefined, ['0.3.1'])).toBe(false)
})

test('only an offered update can be skipped', () => {
  expect(canSkip({ status: 'downloading', current: '0.3.0', version: '0.3.1' })).toBe(true)
  expect(canSkip({ status: 'ready', current: '0.3.0', version: '0.3.1' })).toBe(true)
  expect(canSkip({ status: 'idle', current: '0.3.0' })).toBe(false)
  expect(canSkip({ status: 'skipped', current: '0.3.0', version: '0.3.1' })).toBe(false)
  expect(canSkip({ status: 'ready', current: '0.3.0' })).toBe(false)
})

test('release notes link to the GitHub release of the version', () => {
  expect(releaseNotesUrl('0.3.0')).toBe('https://github.com/Phantom-456/instant-browser/releases/tag/v0.3.0')
  expect(releaseNotesUrl('v0.4.0-rc.1')).toBe('https://github.com/Phantom-456/instant-browser/releases/tag/v0.4.0-rc.1')
})

test('a problem report link fills in the version and the system, nothing else', () => {
  const url = new URL(problemReportUrl({ version: '0.3.0', system: 'macOS 15.2', arch: 'arm64' }))
  expect(url.origin + url.pathname).toBe('https://github.com/Phantom-456/instant-browser/issues/new')
  expect(Object.fromEntries(url.searchParams)).toEqual({ template: 'bug.yml', title: '[0.3.0] ', version: '0.3.0', system: 'macOS 15.2, Apple silicon' })
  expect(new URL(problemReportUrl({ version: '0.3.0', system: 'macOS 14.1', arch: 'x64' })).searchParams.get('system')).toBe('macOS 14.1, Intel')
})
