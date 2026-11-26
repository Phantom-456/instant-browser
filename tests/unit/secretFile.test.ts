import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecretFile, SecretKeyStore, isStableSignature, type SafeLike } from '../../src/main/sync/secretFile'

/** A pretend keychain. `trusted` is false when the keychain no longer trusts this build (a new, differently signed build). */
const keychain = (): SafeLike & { trusted: boolean } => {
  const k = {
    trusted: true,
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`KC1:${Buffer.from(s).toString('base64')}`),
    decryptString: (b: Buffer) => {
      if (!k.trusted) throw new Error('the keychain does not trust this build')
      const t = b.toString()
      if (!t.startsWith('KC1:')) throw new Error('not a keychain item')
      return Buffer.from(t.slice(4), 'base64').toString()
    }
  }
  return k
}
const dir = () => join(mkdtempSync(join(tmpdir(), 'ib-secret-')), 'secret.bin')

describe('where secrets are kept', () => {
  it('file mode: kept in a file only you can read, and it survives an update (the keychain is not used at all)', () => {
    const path = dir()
    const safe = keychain()
    new SecretFile(path, safe, 'file').save('refresh-token-123')
    expect(readFileSync(path, 'utf8')).toContain('refresh-token-123') // plain, as the doc says: protected by the file mode
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    safe.trusted = false // the next build is a "stranger" to the keychain
    expect(new SecretFile(path, safe, 'file').load()).toBe('refresh-token-123') // still there: no need to connect again
  })

  it('keychain mode: encrypted, and not written in the clear', () => {
    const path = dir()
    new SecretFile(path, keychain(), 'keychain').save('refresh-token-123')
    expect(readFileSync(path, 'utf8')).not.toContain('refresh-token-123')
    expect(new SecretFile(path, keychain(), 'keychain').load()).toBe('refresh-token-123')
  })

  it('keychain mode writes nothing when the keychain is not available', () => {
    const path = dir()
    const safe = { ...keychain(), isEncryptionAvailable: () => false }
    new SecretFile(path, safe, 'keychain').save('secret')
    expect(() => readFileSync(path)).toThrow()
  })

  it('a secret the keychain no longer opens is simply not there (the person connects once more)', () => {
    const path = dir()
    const safe = keychain()
    new SecretFile(path, safe, 'keychain').save('secret')
    safe.trusted = false
    expect(new SecretFile(path, safe, 'keychain').load()).toBeNull()
    expect(new SecretFile(path, safe, 'file').load()).toBeNull()
  })

  it('a secret saved by the keychain is moved to the file when the mode is file (if the keychain still opens it), and kept after that', () => {
    const path = dir()
    const safe = keychain()
    new SecretFile(path, safe, 'keychain').save('secret-from-keychain')
    expect(new SecretFile(path, safe, 'file').load()).toBe('secret-from-keychain')
    safe.trusted = false // after the move the keychain is not needed
    expect(new SecretFile(path, safe, 'file').load()).toBe('secret-from-keychain')
  })

  it('and the other way: a file secret moves into the keychain when the app is signed later', () => {
    const path = dir()
    const safe = keychain()
    new SecretFile(path, safe, 'file').save('secret-from-file')
    expect(new SecretFile(path, safe, 'keychain').load()).toBe('secret-from-file')
    expect(readFileSync(path, 'utf8')).not.toContain('secret-from-file') // it is encrypted now
  })

  it('clear removes it; a missing or empty file is just "nothing saved"', () => {
    const path = dir()
    const file = new SecretFile(path, keychain(), 'file')
    expect(file.load()).toBeNull()
    file.save('x')
    file.clear()
    expect(file.load()).toBeNull()
    writeFileSync(path, '')
    expect(file.load()).toBeNull()
  })

  it('the sync key goes through the same file', () => {
    const store = new SecretKeyStore(new SecretFile(dir(), keychain(), 'file'))
    expect(store.load()).toBeNull()
    store.save({ key: 'abc', salt: 'def' })
    expect(store.load()).toEqual({ key: 'abc', salt: 'def' })
    store.clear()
    expect(store.load()).toBeNull()
  })
})

describe('is the app signed in a way the keychain can trust?', () => {
  it('an ad-hoc signature (what every build here has) is not stable; a Developer ID with a team is', () => {
    expect(isStableSignature('Identifier=io.github.x\nSignature=adhoc\nTeamIdentifier=not set\n')).toBe(false)
    expect(isStableSignature('/Applications/X.app: code object is not signed at all')).toBe(false)
    expect(isStableSignature('Identifier=io.github.x\nAuthority=Developer ID Application: Someone (ABCDE12345)\nTeamIdentifier=ABCDE12345\n')).toBe(true)
    expect(isStableSignature('')).toBe(false)
  })
})
