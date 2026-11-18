import { describe, expect, it } from 'vitest'
import { EncryptedStorage, LockedError, WrongPassphraseError, decryptDoc, deriveKey, encryptDoc, isEnvelope, type KeyStore } from '../../src/main/sync/encryption'
import { MemoryStorage, syncOnce } from '../../src/shared/sync/engine'
import { emptyDoc } from '../../src/shared/sync/merge'
import type { SyncPin } from '../../src/shared/sync/portable'

const keyStore = (): KeyStore & { saved: { key: string; salt: string } | null } => {
  const s = { saved: null as { key: string; salt: string } | null, load: () => s.saved, save: (v: { key: string; salt: string }) => { s.saved = v }, clear: () => { s.saved = null } }
  return s
}
const pin = (id: string, url: string): SyncPin => ({ id, url, title: 'Secret title', label: 'My private label', gradient: { seed: 1, stops: [{ h: 1, s: 1, l: 1 }, { h: 2, s: 2, l: 2 }], angle: 1 }, archived: false, createdAt: 1 })

describe('encrypting the synced file', () => {
  it('turns a document into scrambled data that only the same passphrase opens', () => {
    const salt = Buffer.alloc(16, 7)
    const key = deriveKey('correct horse battery staple', salt)
    const envelope = encryptDoc({ secret: 'https://example.com/my-bank-statement' }, key, salt)
    expect(isEnvelope(envelope)).toBe(true)
    expect(JSON.stringify(envelope)).not.toContain('my-bank-statement')
    expect(decryptDoc(envelope, key)).toEqual({ secret: 'https://example.com/my-bank-statement' })
    expect(() => decryptDoc(envelope, deriveKey('wrong passphrase', salt))).toThrow(WrongPassphraseError)
  })

  it('a changed file does not open (it cannot be altered without being noticed)', () => {
    const salt = Buffer.alloc(16, 1)
    const key = deriveKey('pass', salt)
    const envelope = encryptDoc({ a: 1 }, key, salt)
    const flipped = Buffer.from(envelope.data, 'base64')
    flipped[0] = flipped[0]! ^ 1
    expect(() => decryptDoc({ ...envelope, data: flipped.toString('base64') }, key)).toThrow(WrongPassphraseError)
  })

  it('uses a new random iv for every write, so the same text never looks the same twice', () => {
    const salt = Buffer.alloc(16, 2)
    const key = deriveKey('pass', salt)
    const a = encryptDoc({ same: true }, key, salt)
    const b = encryptDoc({ same: true }, key, salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
  })
})

describe('encrypted sync between two computers', () => {
  it('Drive only ever holds scrambled data, and a second computer unlocks it with the passphrase', async () => {
    const drive = new MemoryStorage() // what Google holds
    const mac = new EncryptedStorage(drive, keyStore())
    mac.setUp('my passphrase')
    await syncOnce(mac, { pins: [pin('pin-00000001', 'https://example.com/private-page')], prefs: {}, deleted: [] }, 'mac', 100)
    const stored = JSON.stringify(drive.peek())
    expect(stored).not.toContain('private-page')
    expect(stored).not.toContain('My private label')
    expect(isEnvelope(drive.peek())).toBe(true)

    // A second computer: no key yet. It cannot read, and it cannot write.
    const pc = new EncryptedStorage(drive, keyStore())
    await expect(pc.read()).rejects.toBeInstanceOf(LockedError)
    await expect(pc.write(emptyDoc(), null)).rejects.toBeInstanceOf(LockedError)
    // The wrong passphrase does not open it. The right one does, and then it sees the pin.
    await expect(pc.unlock('not my passphrase')).rejects.toBeInstanceOf(WrongPassphraseError)
    expect(pc.hasKey()).toBe(false)
    await pc.unlock('my passphrase')
    expect(pc.hasKey()).toBe(true)
    const seen = await syncOnce(pc, { pins: [], prefs: {}, deleted: [] }, 'pc', 200)
    expect(seen.ok && Object.keys(seen.doc.pins)).toEqual(['pin-00000001'])
  })

  it('the key is kept on the device, so the next run does not ask again, and it can be forgotten', async () => {
    const drive = new MemoryStorage()
    const keys = keyStore()
    const first = new EncryptedStorage(drive, keys)
    first.setUp('pass')
    await syncOnce(first, { pins: [pin('pin-00000001', 'https://example.com/a')], prefs: {}, deleted: [] }, 'mac', 100)
    expect(keys.saved).not.toBeNull()
    const nextRun = new EncryptedStorage(drive, keys) // the app starts again
    expect(nextRun.hasKey()).toBe(true)
    const seen = await syncOnce(nextRun, { pins: [], prefs: {}, deleted: [] }, 'mac', 200)
    expect(seen.ok).toBe(true)
    nextRun.forgetKey()
    expect(keys.saved).toBeNull()
    await expect(nextRun.read()).rejects.toBeInstanceOf(LockedError)
  })

  it('never writes an unencrypted file, even if asked', async () => {
    const drive = new MemoryStorage()
    const storage = new EncryptedStorage(drive, keyStore())
    await expect(storage.write(emptyDoc(), null)).rejects.toBeInstanceOf(LockedError)
    expect(drive.peek()).toBeNull()
  })

  it('an older file that was not encrypted can still be read, and is written encrypted next', async () => {
    const drive = new MemoryStorage()
    await syncOnce(drive, { pins: [pin('pin-00000001', 'https://example.com/old')], prefs: {}, deleted: [] }, 'mac', 100) // plain, as before
    expect(isEnvelope(drive.peek())).toBe(false)
    const storage = new EncryptedStorage(drive, keyStore())
    storage.setUp('pass')
    const result = await syncOnce(storage, { pins: [pin('pin-00000002', 'https://example.com/new')], prefs: {}, deleted: [] }, 'mac', 200)
    expect(result.ok && Object.keys(result.doc.pins).sort()).toEqual(['pin-00000001', 'pin-00000002'])
    expect(isEnvelope(drive.peek())).toBe(true)
    expect(JSON.stringify(drive.peek())).not.toContain('example.com/old')
  })
})

describe('changing the passphrase', () => {
  it('needs the current passphrase, keeps the data, and locks the other computer until it has the new one', async () => {
    const drive = new MemoryStorage()
    const mac = new EncryptedStorage(drive, keyStore())
    mac.setUp('old passphrase here')
    await syncOnce(mac, { pins: [pin('pin-00000001', 'https://example.com/a')], prefs: {}, deleted: [] }, 'mac', 100)
    const pc = new EncryptedStorage(drive, keyStore())
    await pc.unlock('old passphrase here')

    await expect(mac.rekey('not the current one', 'a brand new passphrase')).rejects.toBeInstanceOf(WrongPassphraseError)
    expect(await mac.rekey('old passphrase here', 'a brand new passphrase')).toBe(true)
    // the data is the same, under the new key
    const seen = await syncOnce(mac, { pins: [], prefs: {}, deleted: [] }, 'mac', 200)
    expect(seen.ok && Object.keys(seen.doc.pins)).toEqual(['pin-00000001'])
    // the other computer has the old key: it finds the file locked and must enter the new passphrase
    expect(await pc.status()).toBe('locked')
    await expect(pc.unlock('old passphrase here')).rejects.toBeInstanceOf(WrongPassphraseError)
    await pc.unlock('a brand new passphrase')
    expect(pc.hasKey()).toBe(true)
  })
})
