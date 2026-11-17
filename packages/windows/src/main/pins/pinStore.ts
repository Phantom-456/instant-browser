import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PIN_STORE_VERSION, parsePinFile, type PinRecord } from '../../shared/pins/model'

/**
 * Keeps the pins in `pins.json` (versioned, written in one step, readable only by the user).
 * A broken file is never thrown away: it is renamed to `pins.json.broken-<time>` and the app starts with no pins.
 * Snapshots (the saved preview of an offloaded page) live in `pins/snapshots/<id>.png`.
 */
export class PinStore {
  private pins: PinRecord[] = []
  /** Set when the last load had to set a file aside or drop entries. */
  recovered: { brokenFile: string | null; dropped: number } = { brokenFile: null, dropped: 0 }
  /** Called after every save (the tray menu listens). */
  onChange: (() => void) | null = null

  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {
    mkdirSync(this.snapshotDir, { recursive: true, mode: 0o700 })
    this.load()
  }

  private get file(): string { return join(this.dir, 'pins.json') }
  get snapshotDir(): string { return join(this.dir, 'snapshots') }
  snapshotPath(id: string): string {
    if (!/^[a-z0-9-]{8,64}$/i.test(id)) throw new Error('bad pin id')
    return join(this.snapshotDir, `${id}.png`)
  }

  private load(): void {
    if (!existsSync(this.file)) return
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      return this.setAside()
    }
    const parsed = parsePinFile(raw)
    if (!parsed.versionOk) return this.setAside()
    this.pins = parsed.pins
    this.recovered.dropped = parsed.dropped
  }

  private setAside(): void {
    const target = `${this.file}.broken-${this.now()}`
    try { renameSync(this.file, target); this.recovered.brokenFile = target } catch { /* nothing more to do */ }
    this.pins = []
  }

  all(): PinRecord[] { return this.pins.slice() }
  get(id: string): PinRecord | undefined { return this.pins.find((p) => p.id === id) }

  /** Add or replace one pin, then save. */
  put(pin: PinRecord): void {
    const i = this.pins.findIndex((p) => p.id === pin.id)
    if (i >= 0) this.pins[i] = pin
    else this.pins.push(pin)
    this.save()
  }

  /** Change one pin with a function, then save. Returns the new record, or undefined if the id is unknown. */
  update(id: string, change: (pin: PinRecord) => PinRecord): PinRecord | undefined {
    const old = this.get(id)
    if (!old) return undefined
    const next = change(old)
    this.put(next)
    return next
  }

  /** Delete a pin for good (not the same as archive) together with its preview. */
  delete(id: string): void {
    this.pins = this.pins.filter((p) => p.id !== id)
    try { rmSync(this.snapshotPath(id), { force: true }) } catch { /* no preview */ }
    this.save()
  }

  private save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: PIN_STORE_VERSION, pins: this.pins }, null, 2), { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, this.file) // one step: a crash leaves the old file or the new one, never half of each
    this.onChange?.()
  }
}
