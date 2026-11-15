/** The sections of the settings window, in order. */
export const SETTINGS_SECTIONS = [
  'General', 'Search engine', 'Appearance', 'Pins', 'Privacy and security', 'Site permissions', 'Downloads', 'About'
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export interface SettingsBubble {
  id: string
  label: string
  /** The settings section this bubble opens. */
  section: SettingsSection
  keywords: string[]
}

const ALL: SettingsBubble[] = [
  { id: 'settings', label: 'Settings', section: 'General', keywords: ['settings', 'preferences', 'options', 'general'] },
  { id: 'hotkey', label: 'Hotkey', section: 'General', keywords: ['hotkey', 'shortcut', 'keyboard', 'keys'] },
  { id: 'pins', label: 'Pin size', section: 'Pins', keywords: ['pin', 'pins', 'size', 'collapse', 'offload', 'memory'] },
  { id: 'search-engine', label: 'Search engine', section: 'Search engine', keywords: ['search', 'engine', 'google', 'duckduckgo', 'bing', 'suggestions'] },
  { id: 'link-router', label: 'Link router', section: 'General', keywords: ['link', 'links', 'router', 'default', 'browser'] },
  { id: 'dia-profile', label: 'Dia profile', section: 'General', keywords: ['dia', 'profile', 'space', 'send'] },
  { id: 'appearance', label: 'Appearance', section: 'Appearance', keywords: ['appearance', 'size', 'zoom', 'window', 'theme', 'dark', 'light', 'top'] },
  { id: 'privacy', label: 'Privacy', section: 'Privacy and security', keywords: ['privacy', 'https', 'secure', 'security', 'clear', 'data', 'history'] },
  { id: 'permissions', label: 'Site permissions', section: 'Site permissions', keywords: ['permissions', 'camera', 'microphone', 'location', 'notifications'] },
  { id: 'downloads', label: 'Downloads', section: 'Downloads', keywords: ['downloads', 'download', 'folder', 'save'] }
]

/** Shown when nothing is typed. */
export const DEFAULT_BUBBLES: SettingsBubble[] = ['settings', 'hotkey', 'search-engine', 'privacy']
  .map((id) => ALL.find((b) => b.id === id)!)

/** Settings that match what the user typed (every word must start a label or keyword word). */
export function matchBubbles(text: string, limit = 4): SettingsBubble[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return DEFAULT_BUBBLES
  return ALL.filter((b) => {
    const pool = [...b.label.toLowerCase().split(/\s+/), ...b.keywords]
    return words.every((w) => pool.some((p) => p.startsWith(w)))
  }).slice(0, limit)
}
