/**
 * The rules for Offload that run by themselves. Pure code: the automation feeds it facts and times.
 *
 * Two triggers, both off until the user turns them on in Settings:
 *  - Time: a collapsed pin that was not used for N minutes (a countdown on the pin).
 *  - Memory: the app uses more than N GB. The OLDEST pins go first (the one unused for the longest time).
 *
 * A pin whose countdown the user paused (a click on the Offload bubble) is never offloaded, by time or by memory.
 */

export const RESTORE_COOLDOWN_MS = 5 * 60_000
export const MEMORY_TARGET = 0.8 // after an Offload by memory, go on until the app uses less than 80% of the limit
export const MEMORY_GAP_MS = 60_000 // wait this long between two Offloads by memory
export const NOTICE_GAP_MS = 10 * 60_000 // do not ask "offload some?" again for this long after the user said not now

export interface PinFacts {
  id: string
  /** The live page is still in memory (collapsed and resident). */
  resident: boolean
  /** The time it was last used. Older goes first. */
  lastUsedAt: number
  restoredAt: number | null
  /** The user paused the countdown: keep this page in memory. */
  userPaused: boolean
  audible: boolean
  downloading: boolean
}

/** Can this pin be offloaded by a rule right now? (Typed text that was not sent is checked when the page is captured.) */
export function isEligible(pin: PinFacts, now: number): boolean {
  if (!pin.resident || pin.userPaused || pin.audible || pin.downloading) return false
  if (pin.restoredAt !== null && now - pin.restoredAt < RESTORE_COOLDOWN_MS) return false
  return true
}

// ---- The countdown on the Offload bubble ----

export type CountdownMode = 'off' | 'running' | 'paused' | 'held'
export interface Countdown {
  mode: CountdownMode
  /** When it ends (running), or null. */
  endsAt: number | null
  /** Time left when it was paused or held. */
  remainingMs: number | null
  totalMs: number
}

export const countdownOff = (totalMs: number): Countdown => ({ mode: 'off', endsAt: null, remainingMs: null, totalMs })
export const countdownStart = (now: number, totalMs: number): Countdown => ({ mode: 'running', endsAt: now + totalMs, remainingMs: null, totalMs })

export function remainingMs(c: Countdown, now: number): number {
  if (c.mode === 'running') return Math.max(0, (c.endsAt ?? now) - now)
  if (c.mode === 'paused' || c.mode === 'held') return c.remainingMs ?? c.totalMs
  return c.totalMs
}

/** The user clicked the bubble: pause, or if it is paused already, go on. */
export function countdownToggle(c: Countdown, now: number): Countdown {
  if (c.mode === 'running' || c.mode === 'held') return { ...c, mode: 'paused', endsAt: null, remainingMs: remainingMs(c, now) }
  if (c.mode === 'paused') return { ...c, mode: 'running', endsAt: now + (c.remainingMs ?? c.totalMs), remainingMs: null }
  return c
}

export const countdownResume = (c: Countdown, now: number): Countdown => (c.mode === 'paused' ? countdownToggle(c, now) : c)

/** Sound or a download holds the countdown (it does not run) until it stops. A pause by the user is stronger and stays. */
export function countdownHold(c: Countdown, now: number, hold: boolean): Countdown {
  if (c.mode === 'running' && hold) return { ...c, mode: 'held', endsAt: null, remainingMs: remainingMs(c, now) }
  if (c.mode === 'held' && !hold) return { ...c, mode: 'running', endsAt: now + (c.remainingMs ?? c.totalMs), remainingMs: null }
  return c
}

/** The total time changed in Settings: the time left never goes above the new total. */
export function countdownRetime(c: Countdown, now: number, totalMs: number): Countdown {
  if (c.mode === 'off') return { ...c, totalMs }
  const left = Math.min(remainingMs(c, now), totalMs)
  if (c.mode === 'running') return { ...c, totalMs, endsAt: now + left }
  return { ...c, totalMs, remainingMs: left }
}

export const countdownDue = (c: Countdown, now: number): boolean => c.mode === 'running' && (c.endsAt ?? Infinity) <= now

// ---- Memory ----

/**
 * Which pin to offload next because of memory, or null. `usedMB` is what the app uses now, `limitMB` the limit.
 * `active` says that an earlier check already went over the limit, so we go on until 80% of the limit.
 */
export function nextMemoryOffload(
  pins: PinFacts[],
  usedMB: number,
  limitMB: number,
  active: boolean,
  lastMemoryOffloadAt: number | null,
  now: number
): { id: string | null; active: boolean } {
  const over = usedMB > limitMB || (active && usedMB > limitMB * MEMORY_TARGET)
  if (!over) return { id: null, active: false }
  if (lastMemoryOffloadAt !== null && now - lastMemoryOffloadAt < MEMORY_GAP_MS) return { id: null, active: true }
  const next = pins.filter((p) => isEligible(p, now)).sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0]
  return { id: next?.id ?? null, active: true }
}

/** How many pins would have to go to get under the limit, if each frees about `perPinMB`. For the notice. */
export function pinsToFree(usedMB: number, limitMB: number, perPinMB: number, eligibleCount: number): number {
  if (eligibleCount <= 0) return 0
  const need = Math.ceil((usedMB - limitMB * MEMORY_TARGET) / Math.max(1, perPinMB))
  return Math.max(1, Math.min(eligibleCount, need))
}

export function countdownLabel(c: Countdown, now: number): string {
  if (c.mode === 'off') return 'Automatic Offload is off'
  const minutes = Math.ceil(remainingMs(c, now) / 60_000)
  const left = minutes <= 1 ? 'less than a minute' : `about ${minutes} minutes`
  if (c.mode === 'paused') return `Paused. This page stays in memory (${left} were left). Click to go on.`
  if (c.mode === 'held') return `Waiting: sound or a download is running (${left} left)`
  return `Offloads in ${left}. Click to pause.`
}
