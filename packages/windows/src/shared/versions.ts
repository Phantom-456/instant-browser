/** Below zero when a is older than b, above zero when newer, zero when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** The highest version that is not a beta, alpha or nightly. */
export function newestStable(versions: string[]): string | null {
  const stable = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v))
  return stable.sort(compareVersions).at(-1) ?? null
}
