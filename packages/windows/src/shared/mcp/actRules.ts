/** Pure rules for agents that click, type and scroll in pages. No Electron here. */

export const TYPE_REFUSED = 'Instant Browser never lets agents type into password, card or one-time-code fields.'
export const NOT_EDITABLE = 'That element cannot be typed into. Pick a text field, a text area or an editable element.'

export interface ElementInfo { tag: string; type?: string; autocomplete?: string; editable?: boolean }

const NON_TEXT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden'])

/** Decide whether an agent may type into an element. Returns an error text, or null when it is fine. */
export function typeRefusal(info: ElementInfo): string | null {
  const tag = info.tag.toLowerCase()
  const type = (info.type ?? '').toLowerCase()
  const tokens = (info.autocomplete ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (type === 'password') return TYPE_REFUSED
  if (tokens.some((t) => t === 'one-time-code' || t.startsWith('cc-') || t.includes('password'))) return TYPE_REFUSED
  const editable = tag === 'textarea' || (tag === 'input' && !NON_TEXT_TYPES.has(type)) || info.editable === true
  return editable ? null : NOT_EDITABLE
}

/** A sliding window: true (and recorded) when the key has made fewer than `max` calls in the last `windowMs`. */
export function underLimit(calls: Map<string, number[]>, key: string, now: number, max: number, windowMs: number): boolean {
  const recent = (calls.get(key) ?? []).filter((at) => now - at < windowMs)
  if (recent.length >= max) { calls.set(key, recent); return false }
  recent.push(now)
  calls.set(key, recent)
  return true
}
