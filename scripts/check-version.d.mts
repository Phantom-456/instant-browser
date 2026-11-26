export function compareSemver(a: string, b: string): number
export function parseChangelog(text: string): { version: string; date: string | null; yanked: boolean }[]
export function changelogSection(text: string, version: string): string
export function shipsToUsers(file: string): boolean
export function changelogReminder(changedFiles: string[]): string
export function checkVersion(input: { pkgVersion: string; changelog: string; tag?: string }): string[]
