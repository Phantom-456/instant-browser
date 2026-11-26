import { describe, expect, test } from 'vitest'
import { resolveInput } from '../../src/shared/resolveInput'

describe('resolveInput', () => {
  test('empty text gives null', () => {
    expect(resolveInput('   ')).toBeNull()
  })
  test('full URL is kept', () => {
    expect(resolveInput('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
  })
  test('bare domain gets https', () => {
    expect(resolveInput('example.com')).toBe('https://example.com')
    expect(resolveInput(' docs.google.com/forms/x ')).toBe('https://docs.google.com/forms/x')
  })
  test('localhost and IP get http', () => {
    expect(resolveInput('localhost:3000')).toBe('http://localhost:3000')
    expect(resolveInput('127.0.0.1:47835/ui')).toBe('http://127.0.0.1:47835/ui')
  })
  test('words become a search', () => {
    expect(resolveInput('define entropy')).toBe('https://www.google.com/search?q=define%20entropy')
  })
  test('one word without a dot becomes a search', () => {
    expect(resolveInput('entropy')).toBe('https://www.google.com/search?q=entropy')
  })
  test('a sentence with a dot becomes a search', () => {
    expect(resolveInput('what is node.js used for')).toBe(
      'https://www.google.com/search?q=what%20is%20node.js%20used%20for'
    )
  })
  test('other schemes are refused', () => {
    expect(resolveInput('file:///etc/passwd')).toBeNull()
    expect(resolveInput('javascript://x')).toBeNull()
  })
  test('custom search template is used', () => {
    expect(resolveInput('cats', 'https://duckduckgo.com/?q=%s')).toBe('https://duckduckgo.com/?q=cats')
  })
})
