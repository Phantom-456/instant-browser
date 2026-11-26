import type { Settings } from '../shared/settings'

/** What a settings change must trigger. The Settings window and the agent tools both use it. */
export interface SettingsEffects {
  /** Register a new hotkey. Returns false when it is taken or not valid. */
  applyHotkey: (accelerator: string) => boolean
  setHotkeyOk: (ok: boolean) => void
  refreshWarm: () => void
  refreshHistory: () => void
  applyMcp: () => void
  setLoginItem: (open: boolean) => void
}

const sameList = (a: string[], b: string[]) => a.join('\u0000') === b.join('\u0000')

/** Run the side effects of a saved settings change. */
export function applySettingsChange(before: Settings, after: Settings, fx: SettingsEffects): void {
  if (after.hotkey !== before.hotkey) fx.setHotkeyOk(fx.applyHotkey(after.hotkey))
  if (after.warmWindow !== before.warmWindow) fx.refreshWarm()
  if (after.showHistory !== before.showHistory || !sameList(after.historyOff, before.historyOff)) fx.refreshHistory()
  if (after.mcpEnabled !== before.mcpEnabled || after.mcpPort !== before.mcpPort) fx.applyMcp()
  if (after.launchAtLogin !== before.launchAtLogin) fx.setLoginItem(after.launchAtLogin)
}
