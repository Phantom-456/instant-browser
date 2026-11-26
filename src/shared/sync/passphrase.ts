/**
 * Helpers for the passphrase that locks the synced data. Pure: the caller gives the random bytes.
 */

/** Letters and numbers without the ones that look alike (no 0, O, 1, I, L): 31 symbols. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** A strong passphrase made by the app: 20 characters in four groups, about 99 bits. Easy to read out and to store in a password manager. */
export function generatePassphrase(randomBytes: (count: number) => Uint8Array): string {
  let text = ''
  while (text.length < 20) {
    for (const b of randomBytes(64)) {
      if (b >= 248) continue // 248 = 31 * 8: throwing away the rest makes every symbol equally likely
      text += ALPHABET[b % 31]
      if (text.length === 20) break
    }
  }
  return text.match(/.{5}/g)!.join('-')
}

export type Strength = 'too-short' | 'ok' | 'good' | 'strong'

/** A plain rule of thumb, not a promise: length matters most. The key is made with a slow hash, which helps against guessing. */
export function strengthOf(passphrase: string): Strength {
  const length = passphrase.length
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(passphrase)).length
  if (length < 8) return 'too-short'
  if (length >= 20 || (length >= 14 && kinds >= 3)) return 'strong'
  if (length >= 12) return 'good'
  return 'ok'
}

export const STRENGTH_TEXT: Record<Strength, string> = {
  'too-short': 'Too short. Use at least 8 characters.',
  ok: 'Okay. A longer one is better: 12 characters or more.',
  good: 'Good.',
  strong: 'Strong.'
}

// ---- The rules for a passphrase ----

export const MIN_PASSPHRASE_LENGTH = 12

/** The passphrases people use most. Compared after removing spaces, dashes and case. Not a full list: a first filter. */
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwertyuiop', 'qwerty123456', 'qwertyuiopasdf', 'iloveyou', 'iloveyou123',
  'letmein', 'letmein123', 'welcome', 'welcome123', 'welcome12345', 'administrator', 'admin123', 'adminadmin', 'abc123', 'abcdefgh', 'abcdefghijkl',
  'abcd1234', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'trustno1', 'whatever', 'shadow', 'master', 'login',
  'changeme', 'changeme123', 'secret', 'secret123', 'mysecret', 'mypassword', 'mypassword1', 'mypassword123', 'google', 'google123', 'apple123',
  'quickpeek', 'quickpeek123', 'talaria', 'talaria123', 'instantbrowser', 'synchronize', 'passphrase', 'mypassphrase', 'correcthorsebatterystaple'
])

export type PassphraseCheck = { ok: true } | { ok: false; reason: string }

/**
 * The rules. A passphrase is refused when it is short (under 12), one of the most common ones, one character repeated, a simple run
 * (123456789012, abcdefghijkl), or has fewer than 6 different characters. These rules cannot make a weak secret strong. They stop the
 * obvious mistakes, because the synced data is only as safe as this passphrase.
 */
export function checkPassphrase(passphrase: string): PassphraseCheck {
  const p = passphrase.normalize('NFKC')
  if (p.length < MIN_PASSPHRASE_LENGTH) return { ok: false, reason: `Too short. Use at least ${MIN_PASSPHRASE_LENGTH} characters.` }
  const squashed = p.toLowerCase().replace(/[\s\-_.]+/g, '')
  if (COMMON.has(squashed) || COMMON.has(squashed.replace(/\d+$/, ''))) return { ok: false, reason: 'This is one of the most common passphrases. Choose another one.' }
  if (new Set(squashed).size < 6) return { ok: false, reason: 'Too many repeated characters. Use a more varied passphrase.' }
  if (isRun(squashed)) return { ok: false, reason: 'This is a simple run of characters (like 123456789012 or abcdefghijkl). Choose another one.' }
  return { ok: true }
}

/** Is the text a straight run up or down (each character one step from the one before)? */
function isRun(text: string): boolean {
  let up = 0
  let down = 0
  for (let i = 1; i < text.length; i++) {
    const d = text.charCodeAt(i) - text.charCodeAt(i - 1)
    if (d === 1) up++
    if (d === -1) down++
  }
  return up >= text.length - 2 || down >= text.length - 2
}
