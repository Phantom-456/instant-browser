// "Open at login" on Windows. Electron writes the Run key, but the user can switch the app off in
// Settings > Apps > Startup (or Task Manager), which Windows keeps in a separate StartupApproved key. Then the Run key
// is still there, so openAtLogin stays true while the app no longer starts. executableWillLaunchAtLogin reads both.

export interface LoginItemState {
  openAtLogin: boolean
  /** Windows only: true when the app is set to open at login and that is not switched off in Startup apps. */
  executableWillLaunchAtLogin?: boolean
}

/** Whether the app really starts at login, so the switch in Settings shows the truth. */
export function launchesAtLogin(state: LoginItemState, platform: NodeJS.Platform): boolean {
  if (platform === 'win32' && typeof state.executableWillLaunchAtLogin === 'boolean') return state.executableWillLaunchAtLogin
  return state.openAtLogin
}

/** What to pass to app.setLoginItemSettings. On Windows "enabled" also clears a switch-off made in Startup apps. */
export function loginItemSettings(on: boolean, platform: NodeJS.Platform): { openAtLogin: boolean; enabled?: boolean } {
  return platform === 'win32' ? { openAtLogin: on, enabled: on } : { openAtLogin: on }
}
