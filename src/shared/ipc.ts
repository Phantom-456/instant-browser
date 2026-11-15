import type { SettingsBubble } from './bubbles'
import type { BrowserInfo } from './browserCommands'
import type { SavedPermission } from './permissions'
import type { Settings } from './settings'
import type { UpdateState } from './updateLabel'

export const SEARCH_SUBMIT = 'search:submit'
export const SEARCH_CANCEL = 'search:cancel'
export const SEARCH_SHOW = 'search:show'
export const SEARCH_SUGGEST = 'search:suggest'
export const SEARCH_RESIZE = 'search:resize'
export const SEARCH_QUERY = 'search:query'
export const SEARCH_OPEN_SETTINGS = 'search:open-settings'
export const SEARCH_HISTORY_CHANGED = 'search:history-changed'

export const TOOLBAR_ACTION = 'toolbar:action'
export const TOOLBAR_STATE = 'toolbar:state'

export type ToolbarAction =
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'navigate'; text: string }
  | { type: 'pin' }
  | { type: 'follow' }
  | { type: 'send' }
  | { type: 'pick-browser' }
  | { type: 'close' }

export interface ToolbarState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  pinned: boolean
  /** The window follows the user to other desktops. */
  following: boolean
  loading: boolean
  error: string | null
}

export const SETTINGS_GET = 'settings:get'
export const SETTINGS_UPDATE = 'settings:update'
export const SETTINGS_ACTION = 'settings:action'
export const SETTINGS_HOTKEY_EVENT = 'settings:hotkey-event'
export const SETTINGS_SECTION = 'settings:section'

/** Everything the settings page shows. */
export interface SettingsView {
  settings: Settings
  hotkeyOk: boolean
  engines: ReadonlyArray<{ name: string; template: string }>
  browsers: BrowserInfo[]
  permissions: SavedPermission[]
  about: { app: string; electron: string; chromium: string }
  platform: string
  /** Instant Browser is the system default browser. */
  isDefaultBrowser: boolean
  /** Dia's profiles: live when Dia is running, else the last list seen. */
  diaProfiles: string[]
  /** The list is live (Dia is running) and not from memory. */
  diaProfilesLive: boolean
  /** Browsers whose history can be read. */
  historySources: string[]
  update: UpdateState
}

export type SettingsAction =
  | { type: 'clear-data' }
  | { type: 'remove-permission'; origin: string; permission: string }
  | { type: 'open-default-browser-settings' }
  | { type: 'choose-download-folder' }
  | { type: 'hotkey-record-start' }
  | { type: 'clear-own-history' }
  | { type: 'check-updates' }
  | { type: 'install-update' }
  | { type: 'hotkey-record-cancel' }

/** Sent to the settings page while it records a new hotkey. */
export interface HotkeyEvent {
  status: 'pending' | 'invalid' | 'done' | 'cancel'
  /** What to show: the keys held so far, or a message. */
  text: string
}

/** What the search bar shows besides the search suggestions. Built from local data, so it is instant. */
export interface BarResults {
  query: string
  settings: SettingsBubble[]
  searches: Array<{ term: string; sources: string[] }>
  pages: Array<{ title: string; url: string; sources: string[] }>
}
