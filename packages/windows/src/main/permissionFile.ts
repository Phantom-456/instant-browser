import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { withDecision, withoutDecision, type SavedPermission } from '../shared/permissions'

function isSaved(value: unknown): value is SavedPermission {
  const v = value as Record<string, unknown> | null
  return !!v && typeof v.origin === 'string' && typeof v.permission === 'string' &&
    (v.decision === 'allow' || v.decision === 'deny')
}

export class PermissionFile {
  private saved: SavedPermission[] = []

  constructor(private readonly path: string) {
    try {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (Array.isArray(raw)) this.saved = raw.filter(isSaved)
    } catch {
      this.saved = [] // missing or broken file: nothing is remembered
    }
  }

  list(): SavedPermission[] {
    return this.saved
  }

  save(entry: SavedPermission): void {
    this.saved = withDecision(this.saved, entry)
    this.write()
  }

  remove(origin: string, permission: string): void {
    this.saved = withoutDecision(this.saved, origin, permission)
    this.write()
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.saved, null, 2))
  }
}
