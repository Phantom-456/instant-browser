export interface DefaultBrowserInfo {
  platform: NodeJS.Platform
  /** macOS sends web links to Instant Browser. */
  isDefault: boolean
  /** The name of the app macOS sends web links to now (for example "Safari"), when known. */
  currentApp: string | null
  /** The app is the installed one, not a development run. */
  packaged: boolean
  /** The app sits in the Applications folder (macOS keeps finding it there). */
  inApplicationsFolder: boolean
}

export interface DefaultBrowserNote {
  text: string
  /** The "Make default" button can work. */
  canMakeDefault: boolean
  warning: string | null
}

/** What the Settings page tells the user about the default browser. */
export function describeDefaultBrowser(info: DefaultBrowserInfo): DefaultBrowserNote {
  if (info.isDefault) {
    return { text: 'Instant Browser is your default browser. Links you click in other apps reach it first.', canMakeDefault: false, warning: null }
  }
  const now = info.currentApp ? `Links go to ${info.currentApp} now.` : 'Instant Browser is not your default browser.'
  if (info.platform === 'win32') {
    return { text: `${now} Windows lets only you choose: open Settings, Apps, Default apps and pick Instant Browser.`, canMakeDefault: false, warning: null }
  }
  if (info.platform !== 'darwin') {
    return { text: now, canMakeDefault: false, warning: null }
  }
  if (!info.packaged) {
    return { text: `${now} This is a development run. Install the app first, then choose it.`, canMakeDefault: false, warning: null }
  }
  return {
    text: `${now} Click "Make default". macOS asks you to confirm. Nothing changes until you do.`,
    canMakeDefault: true,
    warning: info.inApplicationsFolder ? null : 'Move Instant Browser to the Applications folder first, so macOS keeps finding it.'
  }
}
