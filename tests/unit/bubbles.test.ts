import { expect, test } from 'vitest'
import { SETTINGS_SECTIONS } from '../../src/shared/bubbles'

test('the settings sections are the ones the settings window shows, in order', () => {
  expect([...SETTINGS_SECTIONS]).toEqual(['General', 'Search engine', 'Appearance', 'Pins', 'Sync', 'Agents', 'Your browsers', 'Privacy and security', 'Site permissions', 'Downloads', 'About'])
})
