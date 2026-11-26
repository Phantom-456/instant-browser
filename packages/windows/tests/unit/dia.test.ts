import { expect, test } from 'vitest'
import { DIA_ID, DIA_LIST_SCRIPT, DIA_OPEN_SCRIPT, parseProfileNames } from '../../src/shared/dia'
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/shared/settings'

test('profile names are read, trimmed and not repeated', () => {
  expect(parseProfileNames('Workspace\nAviShi\n基地\n Hack \n\nHack\n')).toEqual(['Workspace', 'AviShi', '基地', 'Hack'])
  expect(parseProfileNames('')).toEqual([])
})
test('the scripts take the URL and name as arguments, never inside the script text', () => {
  expect(DIA_OPEN_SCRIPT).toContain('on run argv')
  expect(DIA_OPEN_SCRIPT).not.toMatch(/https?:/)
  expect(DIA_LIST_SCRIPT).toContain('profiles of window 1')
  expect(DIA_ID).toBe('company.thebrowser.dia')
})
test('settings: the Dia profile is a text or nothing, the cached list holds only text', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ diaProfile: null, diaProfiles: [] })
  expect(mergeSettings({ diaProfile: 'Hack' }).diaProfile).toBe('Hack')
  expect(mergeSettings({ diaProfile: 5 }).diaProfile).toBeNull()
  expect(mergeSettings({ diaProfiles: ['Study', 3, 'Hack', ''] }).diaProfiles).toEqual(['Study', 'Hack'])
})
