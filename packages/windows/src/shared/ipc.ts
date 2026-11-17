import type { BrowserInfo } from './browserCommands'
import type { SavedPermission } from './permissions'
import type { DefaultBrowserNote } from './defaultBrowser'
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
export const SEARCH_OPEN_MANAGER = 'search:open-manager'

/** A two-finger swipe in a web page: can the history go that way, and go. */
export const PAGE_SWIPE = 'page:swipe'
export const PAGE_SWIPE_CAN = 'page:swipe-can'

export const BUBBLE_ACTION = 'bubble:action'
export const BUBBLE_HOVER = 'bubble:hover'
/** What a bubble beside the search bar asks for. */
export type BubbleAction = { kind: 'settings'; section?: string } | { kind: 'manager' }
export type BubbleHover = { kind: 'settings' | 'manager'; on: boolean }

export const TOOLBAR_ACTION = 'toolbar:action'
export const TOOLBAR_STATE = 'toolbar:state'

export type ToolbarAction =
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'navigate'; text: string }
  | { type: 'collapse' }
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
export interface ManagerView {
  pins: ManagerRow[]
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
  engines: ReadonlyArray<{ name: string; template: string }>
  browsers: BrowserInfo[]
  permissions: SavedPermission[]
  about: { app: string; electron: string; chromium: string }
  platform: string
  /** Instant Browser is the system default browser. */
  isDefaultBrowser: boolean
  /** What to tell the user about the default browser, and whether the "Make default" button works. */
  defaultBrowser: DefaultBrowserNote
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
  | { type: 'make-default-browser' }
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
  searches: Array<{ term: string; sources: string[] }>
  pages: Array<{ title: string; url: string; sources: string[] }>
}
