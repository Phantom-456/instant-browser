// Windows updates come from the same GitHub repository as the Mac app, but only from releases tagged win-v...
// electron-updater's GitHub reader cannot tell them apart: with pre-releases off it asks GitHub for the latest full
// release, which is a Mac release, and then fails to find latest.yml there. So the app finds the newest win-v release
// itself and points the updater at that one release's files.

export const WIN_RELEASES = { owner: 'Phantom-456', repo: 'instant-browser', tagPrefix: 'win-v' } as const

/** The releases feed (newest first) that lists every release tag. */
export const releasesFeedUrl = (): string => `https://github.com/${WIN_RELEASES.owner}/${WIN_RELEASES.repo}/releases.atom`

/** The folder that holds one release's files, latest.yml among them. */
export const releaseFilesUrl = (tag: string): string =>
  `https://github.com/${WIN_RELEASES.owner}/${WIN_RELEASES.repo}/releases/download/${encodeURIComponent(tag)}`

/** The newest win-v tag in the releases feed, by version number (not by feed order), or null when there is none. */
export function latestWindowsTag(atomXml: string): string | null {
  let best: { tag: string; parts: number[] } | null = null
  for (const match of atomXml.matchAll(/\/releases\/tag\/([^"'<>\s/]+)/g)) {
    const tag = decodeURIComponent(match[1]!)
    if (!tag.startsWith(WIN_RELEASES.tagPrefix)) continue
    const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(tag.slice(WIN_RELEASES.tagPrefix.length))
    if (!version) continue // a test tag such as win-v0.2.0-rc1 is not offered as an update
    const parts = version.slice(1).map(Number)
    if (!best || compareParts(parts, best.parts) > 0) best = { tag, parts }
  }
  return best?.tag ?? null
}

function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}
