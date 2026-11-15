import { expect, test } from 'vitest'
import { DEFAULT_BUBBLES, SETTINGS_SECTIONS, matchBubbles } from '../../src/shared/bubbles'

test('with nothing typed, a few default bubbles show', () => {
  expect(matchBubbles('')).toEqual(DEFAULT_BUBBLES)
  expect(DEFAULT_BUBBLES.length).toBeGreaterThanOrEqual(3)
})
test('typing finds settings by name or keyword', () => {
  expect(matchBubbles('hot')[0]?.id).toBe('hotkey')
  expect(matchBubbles('shortcut')[0]?.id).toBe('hotkey')
  expect(matchBubbles('dark').map((b) => b.id)).toContain('appearance')
  expect(matchBubbles('xyzzy')).toEqual([])
})
test('every bubble opens a real settings section', () => {
  for (const b of matchBubbles('')) expect(SETTINGS_SECTIONS).toContain(b.section)
  for (const word of ['search', 'privacy', 'link', 'dia', 'downloads', 'permissions']) {
    for (const b of matchBubbles(word)) expect(SETTINGS_SECTIONS).toContain(b.section)
  }
})
