import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { STRENGTH_TEXT, checkPassphrase, generatePassphrase, strengthOf } from '../../src/shared/sync/passphrase'

describe('a passphrase made by the app', () => {
  it('has four groups of five easy to read characters, and is different every time', () => {
    const a = generatePassphrase((n) => new Uint8Array(randomBytes(n)))
    const b = generatePassphrase((n) => new Uint8Array(randomBytes(n)))
    expect(a).toMatch(/^[2-9A-HJKMNP-Z]{5}(-[2-9A-HJKMNP-Z]{5}){3}$/)
    expect(a).not.toBe(b)
    expect(a).not.toMatch(/[01ILO]/) // nothing that looks like something else
  })

  it('uses every symbol about equally (no favourites)', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 4000; i++) for (const c of generatePassphrase((n) => new Uint8Array(randomBytes(n))).replace(/-/g, '')) counts.set(c, (counts.get(c) ?? 0) + 1)
    expect(counts.size).toBe(31)
    const values = [...counts.values()]
    const expected = (4000 * 20) / 31
    for (const v of values) expect(Math.abs(v - expected)).toBeLessThan(expected * 0.12)
  })

  it('throws away the random bytes that would favour some symbols', () => {
    // Bytes 248 to 255 would give the first symbols one more chance. They are skipped, so a run of only those bytes is never used.
    let calls = 0
    const text = generatePassphrase(() => { calls++; return calls < 3 ? new Uint8Array(64).fill(255) : new Uint8Array(64).fill(0) })
    expect(text.replace(/-/g, '')).toBe('2'.repeat(20))
    expect(calls).toBeGreaterThanOrEqual(3)
  })
})

describe('how strong a passphrase is', () => {
  it('judges mostly by length', () => {
    expect(strengthOf('short')).toBe('too-short')
    expect(strengthOf('abcdefgh')).toBe('ok')
    expect(strengthOf('abcdefghijkl')).toBe('good')
    expect(strengthOf('correct horse battery staple')).toBe('strong')
    expect(strengthOf('Ab1!Ab1!Ab1!Ab')).toBe('strong')
    expect(Object.keys(STRENGTH_TEXT).sort()).toEqual(['good', 'ok', 'strong', 'too-short'])
  })
})

describe('the rules for a passphrase', () => {
  const reason = (p: string) => { const c = checkPassphrase(p); return c.ok ? 'ok' : c.reason }

  it('refuses short ones, the most common ones, repeats and simple runs', () => {
    expect(reason('12345678')).toMatch(/Too short/)
    expect(reason('password')).toMatch(/Too short/)
    expect(reason('Password123!')).toMatch(/most common|ok/) // 12 characters: only the common ones are caught below
    expect(reason('qwertyuiop asdf')).not.toBe('ok')
    expect(reason('password1234')).toMatch(/most common/)
    expect(reason('Pass-word-123-')).not.toBe('')
    expect(reason('aaaaaaaaaaaaaa')).toMatch(/repeated/)
    expect(reason('abababababab')).toMatch(/repeated/)
    expect(reason('123456789012')).toMatch(/simple run/)
    expect(reason('abcdefghijklmn')).toMatch(/simple run/)
    expect(reason('210987654321')).toMatch(/simple run/)
    expect(reason('correct horse battery staple')).toMatch(/most common/) // the famous example is everywhere
  })

  it('accepts a good one, and the ones the app makes', () => {
    expect(reason('blue-River-83-mango-clock')).toBe('ok')
    expect(reason('my dog eats 3 red apples daily')).toBe('ok')
    for (let i = 0; i < 50; i++) expect(checkPassphrase(generatePassphrase((n) => new Uint8Array(randomBytes(n)))).ok).toBe(true)
  })

  it('ignores case, spaces and dashes when it looks for common ones', () => {
    expect(reason('My-Pass-Word-123')).toMatch(/most common/)
    expect(reason('I LOVE YOU 1 2 3')).toMatch(/most common|ok/)
  })
})
