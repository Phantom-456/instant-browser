import { expect, test } from 'vitest'
import { isAllowedUrl } from '../../src/shared/urlPolicy'

test('http, https and about:blank are allowed', () => {
  expect(isAllowedUrl('https://example.com')).toBe(true)
  expect(isAllowedUrl('http://localhost:3000')).toBe(true)
  expect(isAllowedUrl('about:blank')).toBe(true)
})
test('everything else is refused', () => {
  expect(isAllowedUrl('file:///etc/passwd')).toBe(false)
  expect(isAllowedUrl('javascript:alert(1)')).toBe(false)
  expect(isAllowedUrl('chrome://settings')).toBe(false)
  expect(isAllowedUrl('msteams://x')).toBe(false)
  expect(isAllowedUrl('not a url')).toBe(false)
})
