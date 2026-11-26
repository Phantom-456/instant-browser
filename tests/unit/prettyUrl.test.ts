import { expect, test } from 'vitest'
import { isSecureUrl, prettyUrl } from '../../src/shared/prettyUrl'

test('the label shows the site and the path, without noise', () => {
  expect(prettyUrl('https://www.google.com/search?q=define%20entropy&sei=abc')).toBe('google.com/search')
  expect(prettyUrl('https://docs.google.com/forms/d/e/1FAIpQLSc/viewform')).toBe('docs.google.com/forms/d/e/1FAIpQLSc/viewform')
  expect(prettyUrl('https://example.com/')).toBe('example.com')
  expect(prettyUrl('http://localhost:3000/a')).toBe('localhost:3000/a')
})
test('empty and strange input gives an empty label', () => {
  expect(prettyUrl('')).toBe('')
  expect(prettyUrl('about:blank')).toBe('')
  expect(prettyUrl('not a url')).toBe('')
})
test('only https is secure', () => {
  expect(isSecureUrl('https://example.com')).toBe(true)
  expect(isSecureUrl('http://example.com')).toBe(false)
  expect(isSecureUrl('')).toBe(false)
})
