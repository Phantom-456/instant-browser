/** Recognize paths before either search resolution or online suggestions. */
export function isLocalInput(raw: string): boolean {
  const text = raw.trim().replace(/^(["'])(.*)\1$/, '$2')
  return /^(?:\/|~(?:\/|$)|[a-z]:[\\/]|\\\\|file:)/i.test(text)
}
