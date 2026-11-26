import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ActivityEntry } from '../../shared/mcp/protocol'
import { writeFileAtomic } from '../atomicWrite'

const isEntry = (v: unknown): v is ActivityEntry => {
  const e = v as ActivityEntry
  return !!e && typeof e === 'object' && typeof e.time === 'number' && typeof e.agent === 'string' && typeof e.tool === 'string' &&
    typeof e.args === 'string' && typeof e.ok === 'boolean' && typeof e.message === 'string'
}

/** The changes agents made, one JSON line each, kept in a file. The newest `max` lines are kept. */
export class ActivityLog {
  private entries: ActivityEntry[] = []
  private lines = 0 // lines in the file, broken ones too

  constructor(private readonly path: string, private readonly max = 2000) {
    try {
      const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
      const lines = text.split('\n').filter((l) => l.trim())
      this.lines = lines.length
      for (const line of lines) {
        try {
          const e = JSON.parse(line)
          if (isEntry(e)) {
            if (e.undo !== undefined && !(e.undo && typeof e.undo === 'object' && typeof e.undo.key === 'string')) delete e.undo
            this.entries.push(e)
          }
        } catch { /* a broken line is skipped */ }
      }
      this.entries = this.entries.slice(-this.max)
    } catch { /* an unreadable file is the same as an empty one */ }
  }

  add(entry: ActivityEntry): void {
    this.entries.push(entry)
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max)
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      appendFileSync(this.path, JSON.stringify(entry) + '\n', { mode: 0o600 })
      this.lines++
      if (this.lines > this.max) {
        writeFileAtomic(this.path, this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 })
        this.lines = this.entries.length
      }
    } catch { /* the list in memory still works */ }
  }

  /** The newest entries, newest first. */
  recent(n = 50): ActivityEntry[] {
    return this.entries.slice(-n).reverse()
  }

  /** Take the undo off an entry once it was used. */
  dropUndo(time: number, tool: string): void {
    const e = this.entries.find((x) => x.time === time && x.tool === tool)
    if (!e || !e.undo) return
    delete e.undo
    try {
      writeFileAtomic(this.path, this.entries.map((x) => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 })
      this.lines = this.entries.length
    } catch { /* the list in memory still works */ }
  }

  clear(): void {
    this.entries = []
    this.lines = 0
    try { rmSync(this.path, { force: true }) } catch { /* nothing more to do */ }
  }
}
