import { DEFAULT_SETTINGS, PIN_LIMITS, mergeSettings, type Settings } from '../settings'

/**
 * What an agent may do with each setting.
 * safe: read and change. read: read only. hidden: never shown.
 * Typed on every key, so a new setting that is not classed here does not compile.
 */
export const SETTING_ACCESS: Record<keyof Settings, 'safe' | 'read' | 'hidden'> = {
  // Can break input or take over the computer: never changed by an agent.
  hotkey: 'read',
  launchAtLogin: 'read',
  linkRouter: 'read',
  linkRouterKeys: 'read',
  terminalLinksSmallWindow: 'read', // part of the Windows link router: where links from other apps open
  mainBrowserId: 'read',
  diaProfile: 'read',
  diaProfiles: 'read',
  // Privacy, security and files.
  httpsFirst: 'read',
  sendGpc: 'read',
  askDownloadLocation: 'read',
  downloadFolder: 'read',
  // Harmless look and behaviour.
  searchTemplate: 'read', // an agent could send every search to a site it picks
  alwaysOnTop: 'safe',
  windowSize: 'safe',
  defaultZoom: 'safe',
  updateNotice: 'safe',
  showSuggestions: 'safe',
  showHistory: 'safe',
  historyOff: 'safe',
  warmWindow: 'safe',
  pinSize: 'safe',
  pinArmMs: 'safe',
  maxPins: 'safe',
  autoOffloadInactivity: 'safe',
  autoOffloadMinutes: 'safe',
  autoOffloadMemory: 'safe',
  autoOffloadMemoryGB: 'safe',
  memoryAsk: 'safe',
  // The agent settings: never shown or changed.
  mcpEnabled: 'hidden',
  mcpPort: 'hidden',
  mcpAllowFolders: 'hidden',
  mcpAllowWindows: 'hidden',
  mcpAllowPins: 'hidden',
  mcpAllowPages: 'hidden',
  mcpAllowSettings: 'hidden',
  mcpAllowActions: 'hidden'
}

/** The tool groups an agent can be allowed to use. `read` is always on. */
export type McpGroup = 'read' | 'folders' | 'windows' | 'pins' | 'pages' | 'settings' | 'act'

/** Whether a tool group is switched on. The one place that maps a group to its `mcpAllow*` switch. */
export function capabilityOf(group: McpGroup, s: Settings): boolean {
  switch (group) {
    case 'read': return true
    case 'folders': return s.mcpAllowFolders
    case 'windows': return s.mcpAllowWindows
    case 'pages': return s.mcpAllowPages
    case 'settings': return s.mcpAllowSettings
    case 'act': return s.mcpAllowActions
    case 'pins': return s.mcpAllowPins
  }
}

/** What agents may do right now, for get_settings. Read only: the switches themselves stay hidden and unchangeable. */
export function capabilities(s: Settings): Record<'read' | 'folders' | 'windows' | 'pins' | 'pages' | 'settings' | 'actions', boolean> {
  return {
    read: capabilityOf('read', s),
    folders: capabilityOf('folders', s),
    windows: capabilityOf('windows', s),
    pins: capabilityOf('pins', s),
    pages: capabilityOf('pages', s),
    settings: capabilityOf('settings', s),
    actions: capabilityOf('act', s)
  }
}

const keysOf = (...classes: Array<'safe' | 'read' | 'hidden'>) =>
  (Object.keys(SETTING_ACCESS) as Array<keyof Settings>).filter((k) => classes.includes(SETTING_ACCESS[k]))

/** The keys an agent may change. */
export const changeableKeys = (): Array<keyof Settings> => keysOf('safe')

/** The settings an agent may read: safe and read-only ones, never hidden ones. */
export function visibleSettings(s: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {}
  for (const k of keysOf('safe', 'read')) out[k] = s[k]
  return out as Partial<Settings>
}

/** What a good value looks like, for the error text. */
const RANGES: Partial<Record<keyof Settings, string>> = {
  searchTemplate: 'an https address that contains %s, for example https://duckduckgo.com/?q=%s',
  windowSize: 'an object { width: 320 to 2000, height: 240 to 2000 }, whole numbers',
  defaultZoom: 'a number from 0.5 to 3',
  pinSize: `a whole number from ${PIN_LIMITS.size.min} to ${PIN_LIMITS.size.max}`,
  pinArmMs: `a whole number from ${PIN_LIMITS.armMs.min} to ${PIN_LIMITS.armMs.max}`,
  maxPins: `a whole number from ${PIN_LIMITS.maxPins.min} to ${PIN_LIMITS.maxPins.max}`,
  autoOffloadMinutes: `a whole number from ${PIN_LIMITS.minutes.min} to ${PIN_LIMITS.minutes.max}`,
  autoOffloadMemoryGB: `a number from ${PIN_LIMITS.memoryGB.min} to ${PIN_LIMITS.memoryGB.max}, in steps of 0.1`,
  historyOff: 'a list of browser names (at most 50)'
}

function allowed(key: keyof Settings): string {
  const range = RANGES[key]
  if (range) return range
  return typeof DEFAULT_SETTINGS[key] === 'boolean' ? 'true or false' : 'a valid value'
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return a === b
}

/** A search address must be https, so queries are never sent over plain text or to a script address. */
function goodSearch(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith('https://')) return false
  try { return new URL(value.replace('%s', 'x')).protocol === 'https:' } catch { return false }
}

/** Check one change. Returns the patch to save, or throws with a reason an agent can read. */
export function checkPatch(key: string, value: unknown): Partial<Settings> {
  if (!Object.prototype.hasOwnProperty.call(SETTING_ACCESS, key)) throw new Error(`Unknown setting "${key}". Use get_settings to see the settings.`)
  const k = key as keyof Settings
  if (SETTING_ACCESS[k] === 'hidden') throw new Error('That setting is not available to agents.')
  if (SETTING_ACCESS[k] === 'read') throw new Error(`"${key}" can be read but never changed by an agent. The person can change it in Settings.`)
  const merged = mergeSettings({ [k]: value })[k]
  if (!same(merged, value) || (k === 'searchTemplate' && !goodSearch(value))) {
    throw new Error(`"${key}" must be ${allowed(k)}.`)
  }
  return { [k]: merged }
}

/**
 * Settings that decide what Instant Browser reads from the person's other browsers. An agent can read that data
 * (list_history), so an agent may only make these read LESS: switch reading off, or add a browser to the "off" list.
 * Switching reading back on, or taking a browser off the list, is for the person in Settings. (Windows has no
 * other-browser bookmark settings; same fix as the Mac app, bug hunt 21.)
 */
const READS_OFF_LISTS: Partial<Record<keyof Settings, true>> = { historyOff: true }
const READS_SWITCHES: Partial<Record<keyof Settings, true>> = { showHistory: true }

/** Throws when an agent's change would make Instant Browser read more of the person's browsers than now. */
export function checkNotWider(patch: Partial<Settings>, current: Settings): void {
  for (const [key, value] of Object.entries(patch) as Array<[keyof Settings, unknown]>) {
    if (READS_SWITCHES[key] && value === true && current[key] !== true) {
      throw new Error(`An agent can switch "${key}" off but not on. The person can switch it on in Settings.`)
    }
    if (READS_OFF_LISTS[key] && Array.isArray(value)) {
      const kept = new Set(value)
      const removed = (current[key] as string[]).filter((name) => !kept.has(name))
      if (removed.length) throw new Error(`An agent can add browsers to "${key}" but not take them off (${removed.join(', ')}). The person can do that in Settings.`)
    }
  }
}
