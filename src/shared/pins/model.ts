/**
 * What a pin is, as it is saved on disk. Pure code: no Electron, no files.
 * Cookies and site storage are never part of a pin. They stay in the normal browser session.
 */

export const PIN_STORE_VERSION = 1
/** The longest name a person can give a pin. */
export const MAX_LABEL_LENGTH = 60

export interface GradientStop { h: number; s: number; l: number }
export interface GradientSpec {
  /** The seed the gradient was made from. Stored, so a pin keeps its colours for good. */
  seed: number
  stops: GradientStop[]
  /** Degrees. */
  angle: number
}
export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

/** "resident": the live page stays in memory. "offloaded": the page was released and a snapshot is saved. */
export type PinState = 'resident' | 'offloaded'

export interface PinRecord {
  /** Stable random id. Not made from the address: two pins for one site stay two pins. */
  id: string
  url: string
  /** The last page title we saw. */
  title: string
  /** A name given by the person, or null. */
  label: string | null
  /** The website's own icon as a small picture (a data address), or null. The pin shows it instead of the pin icon. */
  icon: string | null
  state: PinState
  archived: boolean
  archivedAt: number | null
  /** The pin (and the window it came from) is shown on every desktop. Shared by both. */
  following: boolean
  gradient: GradientSpec
  /** Where and how large the window was. Its size is used again when it opens. */
  window: Rect
  /** Where the Collapse button was inside the window (from its top left corner). The window opens with that button on the pin. */
  anchor: Point | null
  /** The centre of the circle, in screen coordinates. */
  pin: Point
  scroll: Point | null
  /** When the saved preview was taken, or null when there is none. */
  snapshotAt: number | null
  createdAt: number
  lastUsedAt: number
  /** For the cool-down after a restore. */
  restoredAt: number | null
}

/** An icon is kept only if it is a small picture as a data address. Anything else is dropped. */
export const MAX_ICON_CHARS = 60_000
export function cleanIcon(value: unknown): string | null {
  return typeof value === 'string' && /^data:image\/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= MAX_ICON_CHARS ? value : null
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPoint = (v: unknown): v is Point => !!v && typeof v === 'object' && finite((v as Point).x) && finite((v as Point).y)
const isRect = (v: unknown): v is Rect =>
  isPoint(v) && finite((v as Rect).width) && finite((v as Rect).height) && (v as Rect).width > 0 && (v as Rect).height > 0

function isGradient(v: unknown): v is GradientSpec {
  const g = v as GradientSpec | null
  return (
    !!g && finite(g.seed) && finite(g.angle) && Array.isArray(g.stops) && g.stops.length >= 2 && g.stops.length <= 3 &&
    g.stops.every((s) => !!s && finite(s.h) && finite(s.s) && finite(s.l))
  )
}

/** One saved record, or null when it is not usable. Everything read from disk goes through here. */
export function parsePin(raw: unknown): PinRecord | null {
  const r = raw as Partial<PinRecord> | null
  if (!r || typeof r !== 'object') return null
  if (typeof r.id !== 'string' || !/^[a-z0-9-]{8,64}$/i.test(r.id)) return null
  if (typeof r.url !== 'string' || r.url.length === 0 || r.url.length > 4096) return null
  if (!isGradient(r.gradient) || !isRect(r.window) || !isPoint(r.pin)) return null
  const now = Date.now()
  return {
    id: r.id,
    url: r.url,
    title: typeof r.title === 'string' ? r.title.slice(0, 300) : '',
    label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, MAX_LABEL_LENGTH) : null,
    icon: cleanIcon(r.icon),
    state: r.state === 'resident' ? 'resident' : 'offloaded',
    archived: r.archived === true,
    archivedAt: finite(r.archivedAt) ? r.archivedAt : null,
    following: r.following === true,
    gradient: r.gradient,
    window: r.window,
    anchor: isPoint(r.anchor) ? r.anchor : null,
    pin: r.pin,
    scroll: isPoint(r.scroll) ? r.scroll : null,
    snapshotAt: finite(r.snapshotAt) ? r.snapshotAt : null,
    createdAt: finite(r.createdAt) ? r.createdAt : now,
    lastUsedAt: finite(r.lastUsedAt) ? r.lastUsedAt : now,
    restoredAt: finite(r.restoredAt) ? r.restoredAt : null
  }
}

/** The whole file: `{ version, pins: [...] }`. Unusable entries are dropped and counted. */
export function parsePinFile(raw: unknown): { pins: PinRecord[]; dropped: number; versionOk: boolean } {
  const file = raw as { version?: unknown; pins?: unknown } | null
  if (!file || typeof file !== 'object' || file.version !== PIN_STORE_VERSION || !Array.isArray(file.pins)) {
    return { pins: [], dropped: 0, versionOk: false }
  }
  const seen = new Set<string>()
  const pins: PinRecord[] = []
  let dropped = 0
  for (const item of file.pins) {
    const pin = parsePin(item)
    if (!pin || seen.has(pin.id)) { dropped++; continue }
    seen.add(pin.id)
    pins.push(pin)
  }
  return { pins, dropped, versionOk: true }
}

export function createPin(
  input: { url: string; title: string; window: Rect; pin: Point; following: boolean; gradient: GradientSpec; icon?: string | null; anchor?: Point | null },
  id: string,
  now: number
): PinRecord {
  return {
    id,
    url: input.url,
    title: input.title,
    label: null,
    icon: cleanIcon(input.icon),
    state: 'resident',
    archived: false,
    archivedAt: null,
    following: input.following,
    gradient: input.gradient,
    window: input.window,
    anchor: input.anchor ?? null,
    pin: input.pin,
    scroll: null,
    snapshotAt: null,
    createdAt: now,
    lastUsedAt: now,
    restoredAt: null
  }
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return '' }
}

/** The name shown on the pin: the person's own name, else the page title, else the site. */
export function labelOf(pin: Pick<PinRecord, 'label' | 'title' | 'url'>): string {
  return pin.label?.trim() || pin.title.trim() || hostOf(pin.url) || 'Untitled page'
}

/** A new name from text the person typed. Empty text clears the name. */
export function normalizeLabel(text: string): string | null {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH).trim()
  return clean || null
}

export const activePins = (pins: PinRecord[]): PinRecord[] => pins.filter((p) => !p.archived)
export const archivedPins = (pins: PinRecord[]): PinRecord[] => pins.filter((p) => p.archived)

/** Remove a pin from view. The record, its colours and its preview are kept (the manager shows the archive later). */
export function archivePin(pin: PinRecord, now: number): PinRecord {
  return { ...pin, archived: true, archivedAt: now }
}

/**
 * Where the window goes when its pin is opened: the Collapse button lands exactly on the pin. Without a saved button
 * place (an old pin) the middle of the top bar is used.
 */
export function windowForPin(window: Rect, anchor: Point | null, pin: Point): Rect {
  const a = anchor ?? { x: window.width / 2, y: 24 }
  return { x: Math.round(pin.x - a.x), y: Math.round(pin.y - a.y), width: window.width, height: window.height }
}

// ---- Keeping things on screen ----

const area = (r: Rect) => r.width * r.height

function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height))
  return Math.hypot(dx, dy)
}

/** Move (and if needed shrink) a window so it lies fully inside the screen area it overlaps most, or the nearest one. */
export function clampRect(rect: Rect, areas: Rect[], margin = 0): Rect {
  if (areas.length === 0) return rect
  const centre: Point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const target = [...areas].sort((a, b) => intersection(rect, b) - intersection(rect, a) || distanceToRect(centre, a) - distanceToRect(centre, b))[0]!
  const width = Math.min(rect.width, Math.max(1, target.width - margin * 2))
  const height = Math.min(rect.height, Math.max(1, target.height - margin * 2))
  return {
    x: Math.round(Math.min(Math.max(rect.x, target.x + margin), target.x + target.width - margin - width)),
    y: Math.round(Math.min(Math.max(rect.y, target.y + margin), target.y + target.height - margin - height)),
    width: Math.round(width),
    height: Math.round(height)
  }
}

/** Move a point (a pin's centre) inside the nearest screen area, keeping `margin` from its edges. */
export function clampPoint(point: Point, areas: Rect[], margin = 0): Point {
  if (areas.length === 0) return point
  const target = [...areas].sort((a, b) => distanceToRect(point, a) - distanceToRect(point, b) || area(b) - area(a))[0]!
  return {
    x: Math.round(Math.min(Math.max(point.x, target.x + margin), target.x + target.width - margin)),
    y: Math.round(Math.min(Math.max(point.y, target.y + margin), target.y + target.height - margin))
  }
}
