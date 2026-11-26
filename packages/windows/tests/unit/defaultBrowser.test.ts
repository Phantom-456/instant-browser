import { expect, test } from 'vitest'
import { describeDefaultBrowser } from '../../src/shared/defaultBrowser'

const base = { platform: 'darwin' as const, isDefault: false, currentApp: 'Safari', packaged: true, inApplicationsFolder: true }

test('when Instant Browser is the default, nothing is offered', () => {
  const note = describeDefaultBrowser({ ...base, isDefault: true })
  expect(note.canMakeDefault).toBe(false)
  expect(note.text).toMatch(/is your default browser/)
})
test('on a Mac, the page says which app gets the links and offers the button, with a warning outside Applications', () => {
  const ok = describeDefaultBrowser(base)
  expect(ok.canMakeDefault).toBe(true)
  expect(ok.text).toContain('Links go to Safari now.')
  expect(ok.warning).toBeNull()
  const away = describeDefaultBrowser({ ...base, inApplicationsFolder: false })
  expect(away.canMakeDefault).toBe(true)
  expect(away.warning).toMatch(/Applications folder/)
})
test('a development run cannot make itself the default', () => {
  const note = describeDefaultBrowser({ ...base, packaged: false })
  expect(note.canMakeDefault).toBe(false)
  expect(note.text).toMatch(/Install the app first/)
})
test('without a known current app the text still makes sense', () => {
  expect(describeDefaultBrowser({ ...base, currentApp: null }).text).toContain('is not your default browser')
})
test('on Windows only the user can choose, so there is no button', () => {
  const note = describeDefaultBrowser({ ...base, platform: 'win32' })
  expect(note.canMakeDefault).toBe(false)
  expect(note.text).toMatch(/Default apps/)
})
test('no long dashes in any text', () => {
  for (const platform of ['darwin', 'win32', 'linux'] as const) {
    for (const isDefault of [true, false]) {
      expect(describeDefaultBrowser({ ...base, platform, isDefault }).text).not.toMatch(/[—–]/)
    }
  }
})
