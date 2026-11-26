export interface UpdateState {
  status: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  /** The version that is running. */
  current: string
  /** The newer version, when there is one. */
  version?: string
  message?: string
  /** Why updates are off: a development run, or Windows, where automatic updates are not switched on yet. */
  off?: 'development' | 'windows'
}

/** Short plain text for the settings page and the menu. */
export function updateLabel(state: UpdateState): string {
  switch (state.status) {
    case 'disabled':
      return state.off === 'windows'
        ? 'Automatic updates are not switched on for Windows yet. New versions are on the GitHub releases page.'
        : 'Updates work only in the installed app, not in a development run.'
    case 'checking': return 'Checking for updates...'
    case 'downloading': return `Downloading version ${state.version ?? ''}...`.replace('  ', ' ')
    case 'ready': return `Version ${state.version ?? ''} is ready. Restart to install it.`.replace('  ', ' ')
    case 'error': return `Could not check for updates. ${state.message ?? ''}`.trim()
    default: return `Version ${state.current}. Up to date.`
  }
}

/** The note shown when an update is downloaded. It points at the menu item by its exact name. */
export function updateReadyNotice(version: string, platform: NodeJS.Platform): { title: string; body: string } {
  const where = platform === 'darwin' ? 'the menu bar icon' : 'the Instant Browser icon in the taskbar notification area'
  return { title: 'Instant Browser update is ready', body: `Version ${version} is downloaded. Open ${where} and choose "Restart to Update".` }
}
