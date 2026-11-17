import { describe, expect, it } from 'vitest'
import {
  MEMORY_GAP_MS, RESTORE_COOLDOWN_MS, countdownDue, countdownHold, countdownResume, countdownRetime, countdownStart, countdownToggle,
  isEligible, nextMemoryOffload, pinsToFree, remainingMs, type PinFacts
} from '../../src/shared/pins/offloadPolicy'

const MIN = 60_000
const pin = (id: string, over: Partial<PinFacts> = {}): PinFacts => ({ id, resident: true, lastUsedAt: 1000, restoredAt: null, userPaused: false, audible: false, downloading: false, ...over })

describe('eligibility', () => {
  it('accepts a plain resident pin', () => expect(isEligible(pin('a'), 10 * MIN)).toBe(true))
  it('refuses a paused pin, sound, a download, a page already released', () => {
    expect(isEligible(pin('a', { userPaused: true }), 0)).toBe(false)
    expect(isEligible(pin('a', { audible: true }), 0)).toBe(false)
    expect(isEligible(pin('a', { downloading: true }), 0)).toBe(false)
    expect(isEligible(pin('a', { resident: false }), 0)).toBe(false)
  })
  it('gives a restored pin 5 minutes of peace', () => {
    expect(isEligible(pin('a', { restoredAt: 1000 }), 1000 + RESTORE_COOLDOWN_MS - 1)).toBe(false)
    expect(isEligible(pin('a', { restoredAt: 1000 }), 1000 + RESTORE_COOLDOWN_MS)).toBe(true)
  })
})

describe('countdown', () => {
  it('runs down and becomes due', () => {
    const c = countdownStart(0, 30 * MIN)
    expect(remainingMs(c, 10 * MIN)).toBe(20 * MIN)
    expect(countdownDue(c, 30 * MIN - 1)).toBe(false)
    expect(countdownDue(c, 30 * MIN)).toBe(true)
  })

  it('a click pauses it (never due), another click goes on from where it stopped', () => {
    const paused = countdownToggle(countdownStart(0, 30 * MIN), 10 * MIN)
    expect(paused.mode).toBe('paused')
    expect(countdownDue(paused, 999 * MIN)).toBe(false)
    expect(remainingMs(paused, 500 * MIN)).toBe(20 * MIN)
    const again = countdownToggle(paused, 100 * MIN)
    expect(again.mode).toBe('running')
    expect(remainingMs(again, 105 * MIN)).toBe(15 * MIN)
  })

  it('right-click resumes a paused countdown, and does nothing to a running one', () => {
    const run = countdownStart(0, 30 * MIN)
    expect(countdownResume(run, 5 * MIN)).toBe(run)
    expect(countdownResume(countdownToggle(run, 5 * MIN), 9 * MIN).mode).toBe('running')
  })

  it('sound or a download holds it; a user pause is not undone by the hold ending', () => {
    const held = countdownHold(countdownStart(0, 30 * MIN), 10 * MIN, true)
    expect(held.mode).toBe('held')
    expect(countdownDue(held, 999 * MIN)).toBe(false)
    expect(remainingMs(countdownHold(held, 50 * MIN, false), 55 * MIN)).toBe(15 * MIN)
    const paused = countdownToggle(countdownStart(0, 30 * MIN), 10 * MIN)
    expect(countdownHold(paused, 20 * MIN, false).mode).toBe('paused')
  })

  it('a new total never leaves more time than the total', () => {
    const c = countdownRetime(countdownStart(0, 120 * MIN), 10 * MIN, 30 * MIN)
    expect(remainingMs(c, 10 * MIN)).toBe(30 * MIN)
    expect(remainingMs(countdownRetime(countdownStart(0, 30 * MIN), 10 * MIN, 120 * MIN), 10 * MIN)).toBe(20 * MIN)
  })
})

describe('memory', () => {
  const pins = [pin('new', { lastUsedAt: 5000 }), pin('old', { lastUsedAt: 1000 }), pin('mid', { lastUsedAt: 3000 })]

  it('does nothing under the limit', () => {
    expect(nextMemoryOffload(pins, 1000, 1500, false, null, 0)).toEqual({ id: null, active: false })
  })

  it('offloads the OLDEST pin first', () => {
    expect(nextMemoryOffload(pins, 1600, 1500, false, null, 10 * MIN).id).toBe('old')
  })

  it('skips a pin whose countdown is paused, and takes the next oldest', () => {
    const list = [pin('old', { lastUsedAt: 1000, userPaused: true }), pin('mid', { lastUsedAt: 3000 })]
    expect(nextMemoryOffload(list, 1600, 1500, false, null, 10 * MIN).id).toBe('mid')
  })

  it('goes on until 80% of the limit, then stops', () => {
    expect(nextMemoryOffload(pins, 1300, 1500, true, null, 10 * MIN)).toEqual({ id: 'old', active: true }) // under the limit but above 80%
    expect(nextMemoryOffload(pins, 1100, 1500, true, null, 10 * MIN)).toEqual({ id: null, active: false }) // below 80%
  })

  it('waits one minute between two Offloads', () => {
    expect(nextMemoryOffload(pins, 1600, 1500, true, 10 * MIN, 10 * MIN + MEMORY_GAP_MS - 1).id).toBeNull()
    expect(nextMemoryOffload(pins, 1600, 1500, true, 10 * MIN, 10 * MIN + MEMORY_GAP_MS).id).toBe('old')
  })

  it('says how many pins to offload for the notice', () => {
    expect(pinsToFree(1700, 1500, 80, 5)).toBe(5)
    expect(pinsToFree(1300, 1500, 80, 5)).toBe(2)
    expect(pinsToFree(1600, 1500, 80, 0)).toBe(0)
  })
})
