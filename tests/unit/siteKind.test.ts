import { describe, expect, it } from 'vitest'
import { siteKind } from '../../src/shared/siteKind'

describe('siteKind', () => {
  it('tells files, local addresses and websites apart', () => {
    expect(siteKind('file:///Users/a/doc.pdf')).toBe('file')
    expect(siteKind('http://localhost:3000/x')).toBe('local')
    expect(siteKind('http://192.168.1.5/')).toBe('local')
    expect(siteKind('https://example.com/')).toBe('secure')
    expect(siteKind('http://example.com/')).toBe('plain')
    expect(siteKind('about:blank')).toBe('other')
    expect(siteKind('nonsense')).toBe('other')
  })
})
