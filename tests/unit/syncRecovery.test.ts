import { describe, expect, it } from 'vitest'
import { EncryptedStorage, WrongPassphraseError, cleanRecoveryKey, newRecoveryKey } from '../../src/main/sync/encryption'

function memory() {
  let stored: { doc: unknown; etag: string } | null = null
  let n = 0
  return {
    async read() { return stored },
    async write(doc: unknown, etag: string | null) { if (stored && etag !== stored.etag) return false; stored = { doc, etag: String(++n) }; return true }
  }
}
const keys = () => { let v: { key: string; salt: string } | null = null; return { load: () => v, save: (x: { key: string; salt: string }) => { v = x }, clear: () => { v = null } } }

describe('recovery key', () => {
  it('makes keys that clean up typing mistakes', () => {
    const k = newRecoveryKey()
    expect(k).toMatch(/^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/)
    expect(cleanRecoveryKey(k.toLowerCase().replace(/-/g, ' '))).toBe(k.replace(/-/g, ''))
    expect(cleanRecoveryKey('too short')).toBeNull()
  })

  it('opens the data on a computer that lost the passphrase, and survives later writes', async () => {
    const store = memory()
    const a = new EncryptedStorage(store as never, keys())
    a.setUp('correct horse battery staple 42')
    await a.write({ hello: 1 } as never, null)
    const recovery = await a.makeRecoveryKey()
    expect(recovery).toBeTruthy()
    const remote = await store.read()
    await a.write({ hello: 2 } as never, remote!.etag) // the recovery wrap is kept on every write

    const b = new EncryptedStorage(store as never, keys())
    await expect(b.unlockWithRecovery(newRecoveryKey())).rejects.toBeInstanceOf(WrongPassphraseError)
    await b.unlockWithRecovery(recovery!.toLowerCase())
    expect((await b.read())!.doc).toEqual({ hello: 2 })
  })

  it('is dropped when the passphrase changes (the old recovery key no longer fits)', async () => {
    const store = memory()
    const a = new EncryptedStorage(store as never, keys())
    a.setUp('correct horse battery staple 42')
    await a.write({ x: 1 } as never, null)
    const recovery = await a.makeRecoveryKey()
    expect(await a.rekey('correct horse battery staple 42', 'another long passphrase 99!')).toBe(true)
    expect(a.hasRecovery()).toBe(false)
    const b = new EncryptedStorage(store as never, keys())
    await expect(b.unlockWithRecovery(recovery!)).rejects.toBeInstanceOf(WrongPassphraseError)
  })
})
