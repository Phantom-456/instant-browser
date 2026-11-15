/**
 * What a pin does when the pointer comes near it. It is a small state machine driven by time stamps, so a test can
 * run it with a fake clock.
 *
 *  idle -- pointer enters the circle --> arming  (2 s, the window ignores clicks, the border runs once)
 *  arming -- pointer leaves --> idle
 *  arming -- 2 s pass --> armed                  (now it takes clicks)
 *  armed -- pointer leaves --> grace             (200 ms, so moving from the circle to a bubble does not close it)
 *  grace -- pointer comes back --> armed
 *  grace -- 200 ms pass --> idle
 */

export const ARM_MS = 2000
export const GRACE_MS = 200

export type ArmState =
  | { phase: 'idle' }
  | { phase: 'arming'; since: number }
  | { phase: 'armed' }
  | { phase: 'grace'; since: number }

export type ArmEvent = 'enter' | 'leave' | 'tick'

export const IDLE: ArmState = { phase: 'idle' }

export function stepArming(state: ArmState, event: ArmEvent, now: number): ArmState {
  switch (state.phase) {
    case 'idle':
      return event === 'enter' ? { phase: 'arming', since: now } : state
    case 'arming':
      if (event === 'leave') return IDLE
      return now - state.since >= ARM_MS ? { phase: 'armed' } : state
    case 'armed':
      return event === 'leave' ? { phase: 'grace', since: now } : state
    case 'grace':
      if (event === 'enter') return { phase: 'armed' }
      return now - state.since >= GRACE_MS ? IDLE : state
  }
}

/** Does the window take mouse clicks now? Not while arming: a click then goes to the app behind the pin. */
export const takesClicks = (state: ArmState): boolean => state.phase === 'armed' || state.phase === 'grace'

/** Is the group open (shown larger)? */
export const isOpen = (state: ArmState): boolean => state.phase !== 'idle'

/** How far the arming border has run, 0 to 1. */
export function armProgress(state: ArmState, now: number): number {
  if (state.phase === 'armed' || state.phase === 'grace') return 1
  if (state.phase === 'idle') return 0
  return Math.min(1, Math.max(0, (now - state.since) / ARM_MS))
}

/** The time at which the machine next needs a `tick`, or null when it waits for the pointer. */
export function nextTickAt(state: ArmState): number | null {
  if (state.phase === 'arming') return state.since + ARM_MS
  if (state.phase === 'grace') return state.since + GRACE_MS
  return null
}
