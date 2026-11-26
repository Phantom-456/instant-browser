export interface UpdateState {
  status: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'skipped' | 'error'
  /** The version that is running. */
  current: string
  /** The newer version, when there is one. */
  version?: string
  message?: string
}

/** Short plain text for the settings page and the menu. */
export function updateLabel(state: UpdateState): string {
  switch (state.status) {
    case 'disabled': return 'Updates work only in the installed app, not in a development run.'
    case 'checking': return 'Checking for updates...'
    case 'downloading': return `Downloading version ${state.version ?? ''}...`.replace('  ', ' ')
    case 'ready': return `Version ${state.version ?? ''} is ready. Restart to install it.`.replace('  ', ' ')
    case 'skipped': return `Version ${state.current}. You skipped version ${state.version ?? ''}.`.replace(' .', '.')
    case 'error': return `Could not check for updates. ${state.message ?? ''}`.trim()
    default: return `Version ${state.current}. Up to date.`
  }
}

/** The GitHub release page (its notes come from CHANGELOG.md) of a Mac version. */
export function releaseNotesUrl(version: string): string {
  return `https://github.com/Phantom-456/instant-browser/releases/tag/v${encodeURIComponent(version.replace(/^v/, ''))}`
}

/**
 * A new GitHub issue with the problem report form, the Talaria version and the system already filled in.
 * Only version numbers go in the link: nothing about the person or their pages.
 */
export function problemReportUrl(info: { version: string; system: string; arch: string }): string {
  const params = new URLSearchParams({
    template: 'bug.yml',
    title: `[${info.version}] `,
    version: info.version,
    system: `${info.system}, ${info.arch === 'arm64' ? 'Apple silicon' : info.arch === 'x64' ? 'Intel' : info.arch}`
  })
  return `https://github.com/Phantom-456/instant-browser/issues/new?${params.toString()}`
}

/** A version the person skipped is never downloaded or installed. Leading "v" and spaces are ignored. */
export function isSkipped(version: string | undefined, skipped: readonly string[]): boolean {
  if (!version) return false
  const clean = (v: string) => v.trim().replace(/^v/, '')
  return skipped.some((v) => clean(v) === clean(version))
}

/** Can the person skip the update that is offered right now? */
export function canSkip(state: UpdateState): boolean {
  return (state.status === 'downloading' || state.status === 'ready') && !!state.version
}
