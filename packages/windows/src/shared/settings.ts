import { LINK_KEY_PRESETS } from './linkRouter'
import { DEFAULT_SEARCH } from './resolveInput'

export interface Settings {
  hotkey: string
  searchTemplate: string
  mainBrowserId: string | null
  alwaysOnTop: boolean
  windowSize: { width: number; height: number }
  launchAtLogin: boolean
  defaultZoom: number
  httpsFirst: boolean
  sendGpc: boolean
  updateNotice: boolean
  askDownloadLocation: boolean
  downloadFolder: string | null
  showSuggestions: boolean
  /** Link router: while Instant Browser is the default browser, links go to the main browser unless keys are held. */
  linkRouter: boolean
  /** Id of a preset in LINK_KEY_PRESETS. */
  linkRouterKeys: string
  /** Name of the Dia profile that "send to browser" opens links in. null means Dia's current profile. */
  diaProfile: string | null
  /** The Dia profile names seen last time. Used when Dia is not running. */
  diaProfiles: string[]
  /** Show history from your browsers in the search bar. */
  showHistory: boolean
  /** Browsers (by name) whose history is not read. */
  historyOff: string[]
  /** Keep a hidden window ready, so the next one opens at once. Uses about 40 MB more memory while ready. */
  warmWindow: boolean
  /** Links that come from a terminal or a code editor open in a small window, with no keys needed. */
  terminalLinksSmallWindow: boolean
  /** Size of a collapsed pin (the circle), in points. The same as the Collapse button in the toolbar. */
  pinSize: number
  /** How long the pointer must rest on a pin before it takes clicks, in milliseconds. 0 means at once. */
  pinArmMs: number
  /** The most pins that can exist at once. A pin with a live page has a window of about 20 MB; a released pin costs almost nothing. */
  maxPins: number
  /** Offload pins that were not used for a while. Off by default. */
  autoOffloadInactivity: boolean
  autoOffloadMinutes: number
  /** Offload the least recently used pins when the app uses too much memory. Off by default. */
  autoOffloadMemory: boolean
  autoOffloadMemoryGB: number
  /** When memory is over the limit, ask before offloading (on), or offload without asking (off). */
  memoryAsk: boolean
}

/** The pin sizes the user can choose: three smaller and three larger than the default (28). */
export const PIN_SIZES: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Smallest', value: 19 },
  { label: 'Smaller', value: 22 },
  { label: 'Small', value: 25 },
  { label: 'Default', value: 28 },
  { label: 'Large', value: 31 },
  { label: 'Larger', value: 34 },
  { label: 'Largest', value: 37 }
]

export const PIN_LIMITS = {
  size: { min: 19, max: 37 },
  armMs: { min: 0, max: 30_000 },
  maxPins: { min: 4, max: 40 },
  minutes: { min: 5, max: 240 },
  memoryGB: { min: 0.5, max: 8 }
} as const

export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'Control+Alt+Space',
  searchTemplate: DEFAULT_SEARCH,
  mainBrowserId: null,
  alwaysOnTop: true,
  windowSize: { width: 480, height: 640 },
  launchAtLogin: false,
  defaultZoom: 1,
  httpsFirst: true,
  sendGpc: true,
  updateNotice: true,
  askDownloadLocation: true,
  downloadFolder: null,
  showSuggestions: true,
  linkRouter: true,
  linkRouterKeys: 'option+command',
  diaProfile: null,
  diaProfiles: [],
  showHistory: true,
  historyOff: [],
  warmWindow: true,
  terminalLinksSmallWindow: true,
  pinArmMs: 2000,
  pinSize: 28, // the same size as the Collapse button in the toolbar
  maxPins: 12,
  autoOffloadInactivity: false,
  autoOffloadMinutes: 30,
  autoOffloadMemory: false,
  autoOffloadMemoryGB: 1.5,
  memoryAsk: true
}

export const SEARCH_ENGINES: ReadonlyArray<{ name: string; template: string }> = [
  { name: 'Google', template: 'https://www.google.com/search?q=%s' },
  { name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
  { name: 'Bing', template: 'https://www.bing.com/search?q=%s' },
  { name: 'Brave', template: 'https://search.brave.com/search?q=%s' }
]

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), min), max)
    : fallback
}

/** Take anything read from disk and return valid settings. */
export function mergeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const size = (r.windowSize && typeof r.windowSize === 'object' ? r.windowSize : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  return {
    hotkey: typeof r.hotkey === 'string' && r.hotkey ? r.hotkey : d.hotkey,
    searchTemplate:
      typeof r.searchTemplate === 'string' && r.searchTemplate.includes('%s') ? r.searchTemplate : d.searchTemplate,
    mainBrowserId: typeof r.mainBrowserId === 'string' && r.mainBrowserId ? r.mainBrowserId : null,
    alwaysOnTop: typeof r.alwaysOnTop === 'boolean' ? r.alwaysOnTop : d.alwaysOnTop,
    windowSize: {
      width: clampNumber(size.width, d.windowSize.width, 320, 2000),
      height: clampNumber(size.height, d.windowSize.height, 240, 2000)
    },
    launchAtLogin: bool(r.launchAtLogin, d.launchAtLogin),
    defaultZoom:
      typeof r.defaultZoom === 'number' && Number.isFinite(r.defaultZoom)
        ? Math.min(Math.max(r.defaultZoom, 0.5), 3)
        : d.defaultZoom,
    httpsFirst: bool(r.httpsFirst, d.httpsFirst),
    sendGpc: bool(r.sendGpc, d.sendGpc),
    updateNotice: bool(r.updateNotice, d.updateNotice),
    askDownloadLocation: bool(r.askDownloadLocation, d.askDownloadLocation),
    downloadFolder: typeof r.downloadFolder === 'string' && r.downloadFolder ? r.downloadFolder : null,
    showSuggestions: bool(r.showSuggestions, d.showSuggestions),
    linkRouter: bool(r.linkRouter, d.linkRouter),
    linkRouterKeys:
      typeof r.linkRouterKeys === 'string' && LINK_KEY_PRESETS.some((p) => p.id === r.linkRouterKeys)
        ? r.linkRouterKeys
        : d.linkRouterKeys,
    diaProfile: typeof r.diaProfile === 'string' && r.diaProfile ? r.diaProfile : null,
    diaProfiles: Array.isArray(r.diaProfiles)
      ? r.diaProfiles.filter((n): n is string => typeof n === 'string' && n !== '').slice(0, 100)
      : d.diaProfiles,
    showHistory: bool(r.showHistory, d.showHistory),
    warmWindow: bool(r.warmWindow, d.warmWindow),
    terminalLinksSmallWindow: bool(r.terminalLinksSmallWindow, d.terminalLinksSmallWindow),
    pinArmMs: clampNumber(r.pinArmMs, d.pinArmMs, PIN_LIMITS.armMs.min, PIN_LIMITS.armMs.max),
    pinSize: clampNumber(r.pinSize, d.pinSize, PIN_LIMITS.size.min, PIN_LIMITS.size.max),
    maxPins: clampNumber(r.maxPins, d.maxPins, PIN_LIMITS.maxPins.min, PIN_LIMITS.maxPins.max),
    autoOffloadInactivity: bool(r.autoOffloadInactivity, d.autoOffloadInactivity),
    autoOffloadMinutes: clampNumber(r.autoOffloadMinutes, d.autoOffloadMinutes, PIN_LIMITS.minutes.min, PIN_LIMITS.minutes.max),
    autoOffloadMemory: bool(r.autoOffloadMemory, d.autoOffloadMemory),
    memoryAsk: bool(r.memoryAsk, d.memoryAsk),
    autoOffloadMemoryGB:
      typeof r.autoOffloadMemoryGB === 'number' && Number.isFinite(r.autoOffloadMemoryGB)
        ? Math.min(Math.max(Math.round(r.autoOffloadMemoryGB * 10) / 10, PIN_LIMITS.memoryGB.min), PIN_LIMITS.memoryGB.max)
        : d.autoOffloadMemoryGB,
    historyOff: Array.isArray(r.historyOff) ? r.historyOff.filter((n): n is string => typeof n === 'string' && n !== '').slice(0, 50) : d.historyOff
  }
}

/**
 * Settings that belong to one computer. A future sync between computers must not copy these:
 * a hotkey that works on the Mac may be taken by another app on the Windows PC.
 */
export const DEVICE_ONLY_SETTINGS: ReadonlyArray<keyof Settings> = ['hotkey']
