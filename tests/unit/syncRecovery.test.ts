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

describe('the recovery key is not lost (bug hunt 14)', () => {
  it('survives a write from a computer that has not seen it yet', async () => {
    const store = memory()
    const ks = keys()
    const a = new EncryptedStorage(store as never, ks)
    a.setUp('correct horse battery staple 42')
    await a.write({ hello: 1 } as never, null)
    const b = new EncryptedStorage(store as never, keys())
    await b.unlock('correct horse battery staple 42') // b knows: no recovery key yet
    const recovery = await a.makeRecoveryKey() // a makes one now
    const remote = await b.read() // b syncs: read, then write the same version
    expect(await b.write({ hello: 2 } as never, remote!.etag)).toBe(true)
    const c = new EncryptedStorage(store as never, keys())
    await c.unlockWithRecovery(recovery!)
    expect((await c.read())!.doc).toEqual({ hello: 2 })
  })

  it('survives a passphrase change that did not happen (another computer wrote first)', async () => {
    const store = memory()
    const a = new EncryptedStorage(store as never, keys())
    a.setUp('correct horse battery staple 42')
    await a.write({ hello: 1 } as never, null)
    const recovery = await a.makeRecoveryKey()
    const realWrite = store.write
    let once = true
    store.write = async (doc, etag) => { if (once) { once = false; return false } return realWrite(doc, etag) } // conflict
    expect(await a.rekey('correct horse battery staple 42', 'a brand new passphrase 77')).toBe(false)
    expect(a.hasRecovery()).toBe(true)
    const remote = await store.read()
    await a.write({ hello: 2 } as never, remote!.etag)
    const c = new EncryptedStorage(store as never, keys())
    await c.unlockWithRecovery(recovery!)
    expect((await c.read())!.doc).toEqual({ hello: 2 })
  })
})
