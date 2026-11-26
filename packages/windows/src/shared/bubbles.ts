/** The sections of the settings window, in order. */
export const SETTINGS_SECTIONS = [
  'General', 'Search engine', 'Appearance', 'Pins', 'Agents', 'Privacy and security', 'Site permissions', 'Downloads', 'About'
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
