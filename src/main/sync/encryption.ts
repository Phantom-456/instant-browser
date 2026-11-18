import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import type { SyncStorage } from '../../shared/sync/engine'
import type { SyncDoc } from '../../shared/sync/merge'

/**
 * End-to-end encryption of the synced file. The key comes from a passphrase that only the person knows; Google only ever holds
 * scrambled data. AES-256-GCM: it also detects a wrong passphrase or a changed file (the check fails, nothing is read).
 *
 * The file in Drive is an envelope: { v, kdf, salt, iv, tag, data } with everything in base64. The salt and the settings of the key
 * derivation are not secret. A new random iv is used for every write.
 */

export const ENVELOPE_VERSION = 1
const KEY_BYTES = 32
// scrypt cost: about 100 ms on a laptop. High enough to slow guessing, low enough to start the app quickly.
const SCRYPT = { N: 1 << 15, r: 8, p: 1 }

export interface Envelope {
  v: number
  kdf: { name: 'scrypt'; N: number; r: number; p: number }
  salt: string
  iv: string
  tag: string
  data: string
  /** Optional: the key above, locked a second time with a recovery key (a spare way in). Older versions ignore it. */
  recovery?: RecoveryWrap
}

export interface RecoveryWrap { iv: string; tag: string; wrapped: string }

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
/** A new recovery key: 20 random bytes as 32 letters and digits, in groups of 4. */
export function newRecoveryKey(): string {
  const bytes = randomBytes(20)
  let bits = 0, value = 0, out = ''
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 } }
  return out.match(/.{4}/g)!.join('-')
}
/** Cleans what a person typed (spaces, dashes, lower case, 0/O and 1/I mix-ups) and returns the 32 characters, or null. */
export function cleanRecoveryKey(text: string): string | null {
  const t = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/0/g, 'O').replace(/1/g, 'I')
  return /^[A-Z2-9]{32}$/.test(t) && [...t].every((c) => B32.includes(c)) ? t : null
}
const recoveryKek = (clean: string): Buffer => createHash('sha256').update('quickpeek-recovery-v1').update(clean).digest()

export function wrapKey(key: Buffer, recoveryKey: string): RecoveryWrap {
  const clean = cleanRecoveryKey(recoveryKey)!
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', recoveryKek(clean), iv)
  const wrapped = Buffer.concat([c.update(key), c.final()])
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), wrapped: wrapped.toString('base64') }
}
export function unwrapKey(wrap: RecoveryWrap, recoveryKey: string): Buffer {
  const clean = cleanRecoveryKey(recoveryKey)
  if (!clean) throw new WrongPassphraseError()
  try {
    const d = createDecipheriv('aes-256-gcm', recoveryKek(clean), Buffer.from(wrap.iv, 'base64'))
    d.setAuthTag(Buffer.from(wrap.tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(wrap.wrapped, 'base64')), d.final()])
  } catch { throw new WrongPassphraseError() }
}

export class WrongPassphraseError extends Error {
  constructor() { super('The passphrase is not right, or the file was changed.') }
}
export class LockedError extends Error {
  constructor() { super('The synced data is encrypted. Enter your passphrase to unlock it.') }
}

export const isEnvelope = (raw: unknown): raw is Envelope => {
  const e = raw as Partial<Envelope> | null
  return !!e && typeof e === 'object' && e.v === ENVELOPE_VERSION && typeof e.salt === 'string' && typeof e.iv === 'string' && typeof e.tag === 'string' && typeof e.data === 'string' && !!e.kdf && e.kdf.name === 'scrypt'
}

/** The key for a passphrase and a salt. */
export function deriveKey(passphrase: string, salt: Buffer, kdf = SCRYPT): Buffer {
  return scryptSync(passphrase.normalize('NFKC'), salt, KEY_BYTES, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 })
}

export function encryptDoc(doc: unknown, key: Buffer, salt: Buffer, recovery?: RecoveryWrap | null): Envelope {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(doc), 'utf8'), cipher.final()])
  return { v: ENVELOPE_VERSION, kdf: { name: 'scrypt', ...SCRYPT }, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'), ...(recovery ? { recovery } : {}) }
}

export function decryptDoc(envelope: Envelope, key: Buffer): unknown {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const text = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')
    return JSON.parse(text)
  } catch {
    throw new WrongPassphraseError()
  }
}

/** Where the key is kept on this device (encrypted with the system keychain), so the passphrase is asked only once. */
export interface KeyStore {
  load(): { key: string; salt: string } | null
  save(value: { key: string; salt: string }): void
  clear(): void
}

/**
 * Puts encryption between the sync engine and the real store. Reads are decrypted, writes are encrypted. Three states:
 *  - no key on this device and the file is not encrypted (or does not exist): the first device chooses a passphrase with `setUp`;
 *  - the file is encrypted and this device has no key: reads throw LockedError until `unlock(passphrase)`;
 *  - unlocked: it just works.
 */
export class EncryptedStorage implements SyncStorage {
  private key: Buffer | null
  private salt: Buffer | null
  private recovery: RecoveryWrap | null = null

  constructor(private readonly inner: SyncStorage & { remove?: () => Promise<void> }, private readonly keys: KeyStore) {
    const saved = keys.load()
    this.key = saved ? Buffer.from(saved.key, 'base64') : null
    this.salt = saved ? Buffer.from(saved.salt, 'base64') : null
  }

  hasKey(): boolean { return !!this.key }

  /** Whether the file in Drive has a recovery key (as last seen). */
  hasRecovery(): boolean { return !!this.recovery }

  /**
   * What this device needs before it can sync:
   *  - 'ready': it has the key (and the file, if any, opens with it);
   *  - 'needs-setup': nothing is encrypted yet, so the person chooses a passphrase;
   *  - 'locked': the file in Drive is encrypted by another device, so the person enters that passphrase.
   */
  async status(): Promise<'ready' | 'needs-setup' | 'locked'> {
    const remote = await this.inner.read()
    const encrypted = !!remote && isEnvelope(remote.doc)
    if (remote && isEnvelope(remote.doc)) this.recovery = remote.doc.recovery ?? null
    if (this.key) {
      if (!encrypted) return 'ready'
      try { decryptDoc(remote!.doc as Envelope, this.key); return 'ready' } catch { this.forgetKey(); return 'locked' } // the file was locked again with another passphrase
    }
    return encrypted ? 'locked' : 'needs-setup'
  }

  /** The first device: choose the passphrase. The key is kept here; the file is written encrypted from now on. */
  setUp(passphrase: string): void {
    const salt = randomBytes(16)
    this.keep(deriveKey(passphrase, salt), salt)
  }

  /** Another device: the passphrase must open the file that is already in Drive. Throws WrongPassphraseError if it does not. */
  async unlock(passphrase: string): Promise<void> {
    const remote = await this.inner.read()
    if (!remote || !isEnvelope(remote.doc)) throw new Error('There is no encrypted data in Drive to unlock.')
    const salt = Buffer.from(remote.doc.salt, 'base64')
    const key = deriveKey(passphrase, salt, remote.doc.kdf)
    decryptDoc(remote.doc, key) // throws if the passphrase is wrong
    this.recovery = remote.doc.recovery ?? null
    this.keep(key, salt)
  }

  /**
   * Make a recovery key. The key of this computer is locked a second time with it and written to Drive next to the data.
   * The recovery key is returned once and kept nowhere. Returns null if somebody else wrote the file at the same moment.
   */
  async makeRecoveryKey(): Promise<string | null> {
    if (!this.key || !this.salt) throw new LockedError()
    const remote = await this.inner.read()
    if (!remote || !isEnvelope(remote.doc)) throw new Error('There is no encrypted data in Drive yet.')
    const doc = decryptDoc(remote.doc, this.key) as SyncDoc
    const recoveryKey = newRecoveryKey()
    const wrap = wrapKey(this.key, recoveryKey)
    const ok = await this.inner.write(encryptDoc(doc, this.key, this.salt, wrap) as unknown as SyncDoc, remote.etag)
    if (!ok) return null
    this.recovery = wrap
    return recoveryKey
  }

  /** Another way in: the recovery key opens the file when the passphrase is lost. Throws WrongPassphraseError if it does not fit. */
  async unlockWithRecovery(recoveryKey: string): Promise<void> {
    const remote = await this.inner.read()
    if (!remote || !isEnvelope(remote.doc)) throw new Error('There is no encrypted data in Drive to unlock.')
    if (!remote.doc.recovery) throw new WrongPassphraseError()
    const key = unwrapKey(remote.doc.recovery, recoveryKey)
    decryptDoc(remote.doc, key)
    this.recovery = remote.doc.recovery
    this.keep(key, Buffer.from(remote.doc.salt, 'base64'))
  }

  /**
   * Change the passphrase: the current one must open the file; the file is then locked again with a new key and written back.
   * Other computers have the old key, so they find the file locked and ask for the new passphrase.
   * Returns false if somebody else wrote the file at the same moment (nothing is changed; try again).
   */
  async rekey(current: string, next: string): Promise<boolean> {
    const remote = await this.inner.read()
    let doc: SyncDoc | null = null
    if (remote && isEnvelope(remote.doc)) {
      const key = deriveKey(current, Buffer.from(remote.doc.salt, 'base64'), remote.doc.kdf)
      doc = decryptDoc(remote.doc, key) as SyncDoc // throws WrongPassphraseError if the current passphrase is wrong
    } else if (this.key) {
      throw new Error('There is no encrypted data in Drive to change.')
    }
    const salt = randomBytes(16)
    const key = deriveKey(next, salt)
    this.recovery = null // the old recovery key opened the old key: make a new one after changing the passphrase
    if (doc && remote) {
      const ok = await this.inner.write(encryptDoc(doc, key, salt) as unknown as SyncDoc, remote.etag)
      if (!ok) return false
    }
    this.keep(key, salt)
    return true
  }

  private keep(key: Buffer, salt: Buffer): void {
    this.key = key
    this.salt = salt
    this.keys.save({ key: key.toString('base64'), salt: salt.toString('base64') })
  }

  forgetKey(): void {
    this.key = null
    this.salt = null
    this.keys.clear()
  }

  async read(): Promise<{ doc: unknown; etag: string } | null> {
    const remote = await this.inner.read()
    if (!remote) return null
    if (!isEnvelope(remote.doc)) return remote // an older, not encrypted file (read as it is; it is written encrypted next)
    if (!this.key) throw new LockedError()
    return { doc: decryptDoc(remote.doc, this.key), etag: remote.etag }
  }

  async write(doc: SyncDoc, etag: string | null): Promise<boolean> {
    if (!this.key || !this.salt) throw new LockedError() // nothing leaves this device without being encrypted
    return this.inner.write(encryptDoc(doc, this.key, this.salt, this.recovery) as unknown as SyncDoc, etag)
  }

  async remove(): Promise<void> { await this.inner.remove?.() }
}
