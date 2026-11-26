import { existsSync, readFileSync, rmSync } from 'node:fs'
import { writeFileAtomic } from '../atomicWrite'
import type { TokenStore } from './driveAuth'
import type { KeyStore } from './encryption'

/**
 * Where a small secret (the Google login, the sync key) is kept on this computer. Two modes:
 *
 *  - 'keychain': encrypted with the system (Electron safeStorage: the Mac keychain, Windows DPAPI). Strong, but on a Mac the keychain only
 *    trusts the exact signed app that saved the item. A build without a stable signature (an ad-hoc signed build, which every build of
 *    this project is until it is signed with a Developer ID) looks like a different app after every update, cannot read the old item, and
 *    the person would have to connect Google again at every update. So this mode is used only when the app has a stable signature.
 *  - 'file': a file that only you can read (mode 600), in the app's folder. It survives updates. It is as private as your other local
 *    files (anything running as you can read it), which is the honest limit of an unsigned app. The login can be revoked at any time at
 *    myaccount.google.com/permissions, and the synced data stays locked with the passphrase.
 *
 * A file saved by the other mode is read and moved to the current mode, so nothing is lost when the app gets signed later.
 */
export type SecretMode = 'keychain' | 'file'
const PLAIN = 'plain:v1:'

export interface SafeLike {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export class SecretFile implements TokenStore {
  constructor(private readonly path: string, private readonly safe: SafeLike, private readonly mode: SecretMode) {}

  load(): string | null {
    let raw: Buffer
    try {
      if (!existsSync(this.path)) return null
      raw = readFileSync(this.path)
    } catch { return null }
    const asText = raw.toString('utf8')
    let value: string | null = null
    if (asText.startsWith(PLAIN)) {
      value = asText.slice(PLAIN.length)
    } else {
      try { if (this.safe.isEncryptionAvailable()) value = this.safe.decryptString(raw) } catch { value = null } // an item the keychain will not open for this build
    }
    if (value === null) return null
    // Keep it in the current mode, so a change of mode (or of signature) loses nothing.
    const savedAsPlain = asText.startsWith(PLAIN)
    if ((this.mode === 'file') !== savedAsPlain) this.save(value)
    return value
  }

  save(text: string): void {
    if (this.mode === 'keychain') {
      if (!this.safe.isEncryptionAvailable()) return // never write a secret in the clear when the keychain was asked for
      writeFileAtomic(this.path, this.safe.encryptString(text), { mode: 0o600 })
    } else {
      writeFileAtomic(this.path, PLAIN + text, { mode: 0o600 })
    }
  }

  clear(): void { rmSync(this.path, { force: true }) }
}

/** The sync key, kept in a SecretFile as text. */
export class SecretKeyStore implements KeyStore {
  constructor(private readonly file: TokenStore) {}
  load(): { key: string; salt: string } | null {
    try {
      const v = JSON.parse(this.file.load() ?? 'null') as { key?: unknown; salt?: unknown } | null
      return v && typeof v.key === 'string' && typeof v.salt === 'string' ? { key: v.key, salt: v.salt } : null
    } catch { return null }
  }
  save(value: { key: string; salt: string }): void { this.file.save(JSON.stringify(value)) }
  clear(): void { this.file.clear() }
}

/**
 * Does the output of `codesign -dv` describe a STABLE signature (a Developer ID with a team)? An ad-hoc signature, or none, is not stable:
 * it changes with every build.
 */
export function isStableSignature(codesignOutput: string): boolean {
  if (/Signature=adhoc/i.test(codesignOutput) || /not signed at all/i.test(codesignOutput)) return false
  const team = /TeamIdentifier=(\S+)/.exec(codesignOutput)?.[1]
  return !!team && team !== 'not'
}
