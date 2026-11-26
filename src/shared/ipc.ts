import type { BrowserInfo } from './browserCommands'
import type { SavedPermission } from './permissions'
import type { DefaultBrowserNote } from './defaultBrowser'
import type { Settings } from './settings'
import type { ActivityEntry } from './mcp/protocol'
import type { UpdateState } from './updateLabel'
import type { SyncStatus } from './sync/status'

export const SEARCH_SUBMIT = 'search:submit'
export const SEARCH_CANCEL = 'search:cancel'
export const SEARCH_SHOW = 'search:show'
export const SEARCH_SUGGEST = 'search:suggest'
export const SEARCH_RESIZE = 'search:resize'
export const SEARCH_QUERY = 'search:query'
export const SEARCH_OPEN_SETTINGS = 'search:open-settings'
export const SEARCH_HISTORY_CHANGED = 'search:history-changed'
export const SEARCH_OPEN_MANAGER = 'search:open-manager'
export const SEARCH_SYNC_NOW = 'search:sync-now'

/** A two-finger swipe in a web page: can the history go that way, and go. */
export const PAGE_SWIPE = 'page:swipe'
export const PAGE_SWIPE_CAN = 'page:swipe-can'

export const BUBBLE_ACTION = 'bubble:action'
export const BUBBLE_HOVER = 'bubble:hover'
/** What a bubble beside the search bar asks for. */
export type BubbleAction = { kind: 'settings'; section?: string } | { kind: 'manager' } | { kind: 'sync' }
export type BubbleHover = { kind: 'settings' | 'manager'; on: boolean }

export const TOOLBAR_ACTION = 'toolbar:action'
export const TOOLBAR_STATE = 'toolbar:state'

export type ToolbarAction =
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'navigate'; text: string }
  | { type: 'collapse' }
  | { type: 'bookmark' }
  | { type: 'follow' }
  | { type: 'send' }
  | { type: 'pick-browser' }
  | { type: 'close' }

export interface ToolbarState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  /** The window follows the user to other desktops. */
  following: boolean
  /** The page is bookmarked (the star is filled). */
  bookmarked: boolean
  loading: boolean
  error: string | null
}

export const MANAGER_GET = 'manager:get'
export const MANAGER_ACTION = 'manager:action'
export const MANAGER_CHANGED = 'manager:changed'

/** One pin in the manager list. */
export interface ManagerRow {
  id: string
  /** The name shown: the person's own name, else the page title, else the site. */
  label: string
  customLabel: string
  url: string
  state: 'resident' | 'offloaded'
  archived: boolean
  archivedAt: number | null
  following: boolean
  /** Kept on this computer only: never sent to Google Drive. */
  syncOff: boolean
  /** The website's icon, or null. */
  icon: string | null
  /** The pin's own colours, as CSS. */
  gradient: string
  createdAt: number
  lastUsedAt: number
  snapshotAt: number | null
  pictureBytes: number
  scrollY: number | null
}
export interface ManagerBookmark { id: string; title: string; url: string; createdAt: number; syncOff: boolean }
export interface ManagerDevice { id: string; name: string; updatedAt: number; tabs: Array<{ url: string; title: string; kind: 'window' | 'pin' }> }
export interface ManagerHistoryRow { url: string; title: string; visits: number; lastVisit: number; sources: string[]; /** Opened from Talaria: can be deleted here. */ own: boolean }
/** A folder of the bookmarks from your other browsers (the folders of all browsers merged). */
export interface ManagerMarkFolder { name: string; folders: ManagerMarkFolder[]; marks: Array<{ url: string; title: string; sources: string[]; addedAt: number }> }
export interface ManagerLiveTab { browser: string; url: string; title: string; /** When Talaria first noticed the tab. */ firstSeen: number }
/** An agent folder as Manage shows it. */
export interface ManagerAgentFolder {
  id: string
  name: string
  owner: string
  allowDelete: boolean
  items: Array<{ id: string; title: string; url: string }>
}
export interface ManagerView {
  /** The folders agents made (through MCP). */
  agentFolders: ManagerAgentFolder[]
  /** Bookmarks of your other browsers, merged by address (read only). */
  browserMarks: { count: number; tree: ManagerMarkFolder }
  /** Open tabs of your other browsers (only when "list open tabs" is on). */
  tabs: ManagerLiveTab[]
  /** Recent pages from this app and your other browsers (other browsers: read only). */
  history: ManagerHistoryRow[]
  pins: ManagerRow[]
  /** The bookmarks (the same on every computer when sync is on). */
  bookmarks: ManagerBookmark[]
  /** The pages your other computers have open (only with sync and "share what I have open"). */
  devices: ManagerDevice[]
  archive: ManagerRow[]
  /** Open (expanded) windows. They are not pins. */
  windows: Array<{ id: number; title: string; url: string }>
  platform: string
  /** The most pins allowed, and the memory each uses (for the header). */
  maxPins: number
}
export type ManagerAction =
  | { type: 'open' | 'offload' | 'archive' | 'follow' | 'put-back' | 'delete'; id: string }
  | { type: 'rename'; id: string; text: string }
  | { type: 'show-window' | 'close-window'; windowId: number }
  | { type: 'open-url'; url: string }
  | { type: 'remove-bookmark'; id: string }
  | { type: 'pin-local' | 'bookmark-local'; id: string; off: boolean }
  | { type: 'history-delete'; url: string }
  | { type: 'bookmark-edit'; id: string; title: string; url: string }
  | { type: 'agent-remove-item' | 'agent-move-item'; folderId: string; itemId: string }
  | { type: 'agent-remove-folder'; folderId: string }
  | { type: 'agent-permission'; folderId: string; allowDelete: boolean }

export const PREVIEW_STATE = 'preview:state'
export const PREVIEW_ACTION = 'preview:action'

/** The saved preview that covers a page while an offloaded pin loads it again. */
export interface PreviewState {
  /** The saved picture as a data address, or null when there is none. */
  image: string | null
  takenAt: number | null
  status: 'updating' | 'slow' | 'failed' | 'done'
  message: string
}
export type PreviewAction = { type: 'retry' } | { type: 'cancel' }

export const PIN_STATE = 'pin:state'
export const PIN_EVENT = 'pin:event'

/** What a pin window page shows. Sent from the main process each time something changes. */
export interface PinView {
  id: string
  label: string
  /** The address as a short label (host and path). */
  address: string
  following: boolean
  /** resident: filled circle. offloaded: border only. */
  state: 'resident' | 'offloaded'
  /** The website's own icon (a small picture), or null: then the pin icon shows. */
  icon: string | null
  /** CSS for the pin's own colours. */
  gradient: string
  accent: string
  /** The pin's colours as CSS colours, in order, and the angle in degrees (for the border that draws itself). */
  stops: string[]
  angle: number
  /** The system is in dark mode. */
  dark: boolean
  /** How long the border takes to draw while the pin arms, in milliseconds. */
  armMs: number
  /** Letter colour that is readable on the gradient. */
  ink: 'black' | 'white'
  phase: 'idle' | 'arming' | 'armed' | 'grace'
  /** The pin is being dragged. */
  dragging: boolean
  /** The name is being edited in the capsule. */
  renaming: boolean
  /** The name given by the person, or empty. The page shows it as the starting text when editing. */
  customLabel: string
  /** The countdown to an automatic Offload, shown as a ring on the Offload bubble. */
  countdown: { mode: 'off' | 'running' | 'paused' | 'held'; fraction: number; label: string }
  /** Circle diameter in points. */
  d: number
  /** Rectangles relative to the window. `parts` is null while the pin is closed. */
  circle: { x: number; y: number; width: number; height: number }
  parts: null | {
    side: 'left' | 'right'
    description: { x: number; y: number; width: number; height: number }
    follow: { x: number; y: number; width: number; height: number }
    offload: { x: number; y: number; width: number; height: number }
    remove: { x: number; y: number; width: number; height: number }
  }
}

/** What the pin page tells the main process. */
export type PinEvent =
  | { type: 'pointer'; inside: boolean }
  | { type: 'restore' }
  | { type: 'follow' }
  | { type: 'remove' }
  | { type: 'offload' }
  | { type: 'offload-toggle' }
  | { type: 'offload-resume' }
  | { type: 'rename-start' }
  | { type: 'rename-commit'; text: string }
  | { type: 'rename-cancel' }
  | { type: 'drag-start'; x: number; y: number }
  | { type: 'drag-move'; x: number; y: number }
  | { type: 'drag-end' }

export const SETTINGS_GET = 'settings:get'
export const SETTINGS_UPDATE = 'settings:update'
export const SETTINGS_ACTION = 'settings:action'
export const SETTINGS_HOTKEY_EVENT = 'settings:hotkey-event'
export const SETTINGS_SECTION = 'settings:section'

/** Everything the settings page shows. */
export interface SettingsView {
  settings: Settings
  hotkeyOk: boolean
  /** The hotkey is only watched, so the app in front keeps the key too (Mac, Accessibility permission). */
  hotkeyShared: boolean
  engines: ReadonlyArray<{ name: string; template: string }>
  browsers: BrowserInfo[]
  permissions: SavedPermission[]
  about: { app: string; electron: string; chromium: string }
  platform: string
  /** Talaria is the system default browser. */
  isDefaultBrowser: boolean
  /** What to tell the user about the default browser, and whether the "Make default" button works. */
  defaultBrowser: DefaultBrowserNote
  /** Dia's profiles: live when Dia is running, else the last list seen. */
  diaProfiles: string[]
  /** The list is live (Dia is running) and not from memory. */
  diaProfilesLive: boolean
  /** Browsers whose history can be read. */
  historySources: string[]
  /** Browsers whose bookmarks can be read. */
  bookmarkSources: string[]
  /** Open tabs: what happened when each browser was asked (empty while the switch is off). */
  tabBrowsers: Array<{ name: string; state: 'ok' | 'not-running' | 'denied' | 'error' }>
  /** Open tabs can be listed on this system (a Mac). */
  tabsAvailable: boolean
  update: UpdateState
  /** Google Drive sync. */
  sync: SyncStatus
  /** This computer can ask for Touch ID. */
  touchIdAvailable: boolean
  /** The agent (MCP) server. Keys are never sent here: copying a setup happens in the main process. */
  mcp: { state: 'off' | 'on' | 'in-use' | 'error'; url: string; agents: Array<{ id: string; name: string; createdAt: number }>; folders: Array<{ id: string; name: string; owner: string; allowDelete: boolean; count: number }>; approvals: Array<{ agentId: string; agentName: string; origin: string }>; activity: ActivityEntry[]; /** Set once, right after a copy from the menu: shows "copied" on that agent's row. */ copied?: { agentId: string; label: string } }
}

export type SettingsAction =
  | { type: 'clear-data' }
  | { type: 'remove-permission'; origin: string; permission: string }
  | { type: 'open-default-browser-settings' }
  | { type: 'choose-download-folder' }
  | { type: 'hotkey-record-start' }
  | { type: 'clear-own-history' }
  | { type: 'check-updates' }
  | { type: 'make-default-browser' }
  | { type: 'install-update' }
  | { type: 'skip-update' }
  | { type: 'unskip-updates' }
  | { type: 'open-release-notes' }
  | { type: 'report-problem' }
  | { type: 'hotkey-record-cancel' }
  | { type: 'sync-connect' | 'sync-now' | 'sync-disconnect' | 'sync-disconnect-delete' }
  | { type: 'sync-set-passphrase' | 'sync-unlock'; passphrase: string }
  | { type: 'sync-change-passphrase'; current: string; passphrase: string }
  | { type: 'sync-forget-key' }
  | { type: 'sync-make-recovery' }
  | { type: 'sync-unlock-recovery'; key: string }
  | { type: 'mcp-copy'; target: 'claude' | 'codex' | 'antigravity' | 'json' | 'key'; agentId: string }
  | { type: 'mcp-agent-menu'; agentId: string; menu: 'copy' | 'more'; x: number; y: number }
  | { type: 'mcp-agent-add'; name: string }
  | { type: 'mcp-agent-remove'; id: string }
  | { type: 'mcp-agent-rotate'; id: string }
  | { type: 'mcp-approval-remove'; agentId: string; origin: string }
  | { type: 'mcp-clear-activity' }
  | { type: 'mcp-undo'; time: number }
  | { type: 'mcp-remove-folder'; folderId: string }
  | { type: 'mcp-folder-permission'; folderId: string; allowDelete: boolean }

/** Sent to the settings page while it records a new hotkey. */
export interface HotkeyEvent {
  status: 'pending' | 'invalid' | 'done' | 'cancel'
  /** What to show: the keys held so far, or a message. */
  text: string
}

/** What the search bar shows besides the search suggestions. Built from local data, so it is instant. */
export interface BarResults {
  query: string
  /** Bookmarks that match (all of the newest ones when nothing is typed). */
  bookmarks?: Array<{ title: string; url: string }>
  searches: Array<{ term: string; sources: string[] }>
  pages: Array<{ title: string; url: string; sources: string[] }>
}
