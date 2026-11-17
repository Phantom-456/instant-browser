import { app, dialog } from 'electron'
import type { PinView } from '../../shared/ipc'
import {
  NOTICE_GAP_MS, countdownDue, countdownHold, countdownLabel, countdownOff, countdownResume, countdownRetime, countdownStart, countdownToggle,
  isEligible, nextMemoryOffload, pinsToFree, remainingMs, type Countdown, type PinFacts
} from '../../shared/pins/offloadPolicy'
import type { SettingsFile } from '../settingsFile'

/** What the automation needs from the pin manager. */
export interface AutomationHost {
  /** Facts about every pin that has a live page. */
  facts(): PinFacts[]
  offload(id: string, opts: { ask: boolean }): Promise<{ ok: boolean; reason?: string }>
  showCountdown(id: string, view: PinView['countdown']): void
}

const TICK_MS = 5000
const MEMORY_EVERY_MS = 15_000
const AVERAGE_PIN_MB = 120 // a rough guess of what one page frees, for the notice only

/**
 * Runs the automatic Offload rules (see `shared/pins/offloadPolicy.ts`). Both triggers are off until Settings turns
 * them on. Tests can shorten the time (INSTANT_TEST_OFFLOAD_MS) and fake the memory use (INSTANT_TEST_MEMORY_MB).
 */
export class PinAutomation {
  private readonly countdowns = new Map<string, Countdown>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastMemoryCheck = 0
  private lastMemoryOffloadAt: number | null = null
  private memoryActive = false
  private noticeOpen = false
  private noticeSilentUntil = 0
  private ticking = false

  constructor(private readonly host: AutomationHost, private readonly settings: SettingsFile, private readonly tickMs = Number(process.env.INSTANT_TEST_AUTOTICK ?? TICK_MS)) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(Date.now()), this.tickMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private totalMs(): number {
    const test = Number(process.env.INSTANT_TEST_OFFLOAD_MS)
    return Number.isFinite(test) && test > 0 ? test : this.settings.get().autoOffloadMinutes * 60_000
  }

  /** The user clicked the Offload bubble: pause the countdown, or go on. */
  toggle(id: string, now = Date.now()): void {
    const c = this.countdowns.get(id)
    if (!c || c.mode === 'off') return
    this.countdowns.set(id, countdownToggle(c, now))
    this.show(id, now)
  }

  /** Right-click on a paused countdown. */
  resume(id: string, now = Date.now()): void {
    const c = this.countdowns.get(id)
    if (!c) return
    this.countdowns.set(id, countdownResume(c, now))
    this.show(id, now)
  }

  /** A pin is gone (restored, removed, offloaded). */
  forget(id: string): void { this.countdowns.delete(id) }

  /** Is the countdown of this pin paused by the user? */
  isPaused(id: string): boolean { return this.countdowns.get(id)?.mode === 'paused' }

  private show(id: string, now: number): void {
    const c = this.countdowns.get(id)
    if (!c) return
    this.host.showCountdown(id, { mode: c.mode, fraction: c.mode === 'off' ? 1 : remainingMs(c, now) / Math.max(1, c.totalMs), label: countdownLabel(c, now) })
  }

  /** One round of the rules. `now` is passed in so a test can drive it. */
  async tick(now: number): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const s = this.settings.get()
      const facts = this.host.facts()
      const live = new Set(facts.map((f) => f.id))
      for (const id of [...this.countdowns.keys()]) if (!live.has(id)) this.countdowns.delete(id)

      // The user's own pause counts for both triggers.
      for (const f of facts) f.userPaused = this.countdowns.get(f.id)?.mode === 'paused'

      // ---- Time ----
      const total = this.totalMs()
      for (const f of facts) {
        let c = this.countdowns.get(f.id)
        if (!s.autoOffloadInactivity) c = countdownOff(total)
        else if (!c || c.mode === 'off') c = countdownStart(now, total)
        else c = countdownHold(countdownRetime(c, now, total), now, f.audible || f.downloading)
        this.countdowns.set(f.id, c)
        this.show(f.id, now)
        if (s.autoOffloadInactivity && countdownDue(c, now) && isEligible(f, now)) {
          const result = await this.host.offload(f.id, { ask: false })
          // Typed text that was not sent, or a failed capture: give the pin another full period instead of trying every tick.
          if (!result.ok) this.countdowns.set(f.id, countdownStart(now, total))
          else this.countdowns.delete(f.id)
        }
      }

      // ---- Memory ----
      if (s.autoOffloadMemory && now - this.lastMemoryCheck >= (this.tickMs < MEMORY_EVERY_MS ? this.tickMs : MEMORY_EVERY_MS)) {
        this.lastMemoryCheck = now
        await this.memory(now)
      } else if (!s.autoOffloadMemory) {
        this.memoryActive = false
      }
    } finally {
      this.ticking = false
    }
  }

  /** What the app uses now, in MB: every process of the app together. */
  private usedMB(): number {
    const fake = Number(process.env.INSTANT_TEST_MEMORY_MB)
    if (Number.isFinite(fake) && fake > 0) return fake
    return app.getAppMetrics().reduce((sum, p) => sum + p.memory.workingSetSize, 0) / 1024
  }

  private async memory(now: number): Promise<void> {
    const s = this.settings.get()
    const limitMB = s.autoOffloadMemoryGB * 1024
    const used = this.usedMB()
    const facts = this.host.facts().map((f) => ({ ...f, userPaused: this.isPaused(f.id) }))
    const pick = nextMemoryOffload(facts, used, limitMB, this.memoryActive, this.lastMemoryOffloadAt, now)
    this.memoryActive = pick.active
    if (!pick.id) return
    if (s.memoryAsk) return this.askFirst(facts, used, limitMB, now)
    const result = await this.host.offload(pick.id, { ask: false })
    if (result.ok) { this.lastMemoryOffloadAt = now; this.countdowns.delete(pick.id) }
  }

  /** A small notice: memory is high, offload some pins? The oldest go first. */
  private async askFirst(facts: PinFacts[], used: number, limitMB: number, now: number): Promise<void> {
    if (this.noticeOpen || now < this.noticeSilentUntil) return
    const candidates = facts.filter((f) => isEligible(f, now)).sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    if (candidates.length === 0) return
    const count = pinsToFree(used, limitMB, AVERAGE_PIN_MB, candidates.length)
    this.noticeOpen = true
    try {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        message: `Memory use is high: ${(used / 1024).toFixed(1)} GB (your limit is ${(limitMB / 1024).toFixed(1)} GB).`,
        detail: `Offload ${count} ${count === 1 ? 'pin' : 'pins'}? The oldest pins go first. Pins with a paused countdown stay. Each page is saved as a picture and loads again when you open its pin.`,
        buttons: [`Offload ${count} ${count === 1 ? 'pin' : 'pins'}`, 'Not now'],
        defaultId: 0,
        cancelId: 1
      })
      if (response !== 0) { this.noticeSilentUntil = Date.now() + NOTICE_GAP_MS; return }
      for (const f of candidates.slice(0, count)) {
        const result = await this.host.offload(f.id, { ask: false })
        if (result.ok) this.countdowns.delete(f.id)
      }
      this.lastMemoryOffloadAt = Date.now()
    } finally {
      this.noticeOpen = false
    }
  }
}
