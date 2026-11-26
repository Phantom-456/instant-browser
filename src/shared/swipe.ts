/**
 * A two-finger sideways swipe on the trackpad goes back or forward, like in Chrome. This is the pure part: it reads the
 * stream of wheel events and says how far the swipe has come and when it counts.
 *
 * On a Mac with natural scrolling, swiping the fingers to the right gives a negative horizontal scroll: that is "back".
 */

/** How far (in pixels of scroll) a swipe must go before it navigates. */
export const SWIPE_THRESHOLD = 160
/** Wheel events closer together than this belong to one swipe. */
export const SWIPE_GAP_MS = 140
/** A swipe must be clearly sideways: this much more sideways than up and down. */
const SIDEWAYS_RATIO = 1.8
/** Ignore tiny sideways drift. */
const MIN_INTENT = 14

export type SwipeDirection = 'back' | 'forward'

export interface SwipeState {
  sumX: number
  sumY: number
  lastAt: number
  /** This swipe already navigated: it must not navigate twice. */
  fired: boolean
}

export const newSwipe = (): SwipeState => ({ sumX: 0, sumY: 0, lastAt: -Infinity, fired: false })

export interface SwipeUpdate {
  state: SwipeState
  /** The swipe is sideways (so the arrow shows). */
  active: boolean
  direction: SwipeDirection | null
  /** 0 to 1: how close the swipe is to going back or forward. */
  progress: number
  /** The swipe has just crossed the line: navigate now. */
  fire: boolean
}

export function feedSwipe(prev: SwipeState, deltaX: number, deltaY: number, now: number): SwipeUpdate {
  const fresh = now - prev.lastAt > SWIPE_GAP_MS
  const state: SwipeState = fresh
    ? { sumX: deltaX, sumY: deltaY, lastAt: now, fired: false }
    : { sumX: prev.sumX + deltaX, sumY: prev.sumY + deltaY, lastAt: now, fired: prev.fired }
  const sideways = Math.abs(state.sumX) >= MIN_INTENT && Math.abs(state.sumX) > Math.abs(state.sumY) * SIDEWAYS_RATIO
  if (!sideways) return { state, active: false, direction: null, progress: 0, fire: false }
  const direction: SwipeDirection = state.sumX < 0 ? 'back' : 'forward'
  const progress = Math.min(1, Math.abs(state.sumX) / SWIPE_THRESHOLD)
  const fire = progress >= 1 && !state.fired
  return { state: fire ? { ...state, fired: true } : state, active: true, direction, progress, fire }
}

/** After the last wheel event, has the swipe ended? (The caller checks this on a timer.) */
export const swipeEnded = (state: SwipeState, now: number): boolean => now - state.lastAt > SWIPE_GAP_MS
