import { expect, test } from 'vitest'
import { compareVersions, newestStable } from '../../src/shared/versions'

test('versions compare by number, not by text', () => {
  expect(compareVersions('45.3.2', '45.10.0')).toBeLessThan(0)
  expect(compareVersions('46.0.0', '45.10.0')).toBeGreaterThan(0)
  expect(compareVersions('45.3.2', '45.3.2')).toBe(0)
})
test('newest stable skips beta and alpha', () => {
  expect(newestStable(['46.0.0-beta.2', '45.3.2', '45.10.0', '47.0.0-alpha.1'])).toBe('45.10.0')
  expect(newestStable(['46.0.0-beta.2'])).toBeNull()
})
