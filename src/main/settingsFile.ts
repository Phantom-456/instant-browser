import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { mergeSettings, type Settings } from '../shared/settings'

export class SettingsFile {
  private current: Settings

  constructor(private readonly path: string) {
    let raw: unknown = null
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      raw = null // missing or broken file: use defaults
    }
    this.current = mergeSettings(raw)
  }

  get(): Settings {
    return this.current
  }

  update(patch: Partial<Settings>): Settings {
    this.current = mergeSettings({ ...this.current, ...patch })
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.current, null, 2))
    return this.current
  }
}
