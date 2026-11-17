export interface UpdateState {
  status: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
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
    case 'error': return `Could not check for updates. ${state.message ?? ''}`.trim()
    default: return `Version ${state.current}. Up to date.`
  }
}
