import type { Point, Rect } from './model'

/**
 * Where everything sits when a pin is armed (open). All sizes come from one number, D, the diameter of the circle,
 * so a bigger or smaller pin keeps its shape. Pure maths: the window code asks for a layout and applies it.
 */

/** The capsule that opens around the pin: it is at least this wide, or 5 D, whichever is more. */
export const PILL_MIN_WIDTH = 210
export const PILL_WIDTH_FACTOR = 5
/** Space between the circle and the capsule's border, all around the circle. */
export const PILL_INSET = 5
export const BUBBLE_FACTOR = 0.6 // Follow, Offload and Remove
export const BUBBLE_MIN = 26 // the pin is as small as the toolbar button, so the bubbles keep a size a finger can hit
export const GAP = 6
/** Room around the group for the shadow. */
export const SHADOW_MARGIN = 14

export type Side = 'left' | 'right'

export interface PinLayout {
  /** Which side the description is on. */
  descriptionSide: Side
  /** Window bounds in screen coordinates. */
  bounds: Rect
  /** Everything below is relative to `bounds`. */
  circle: Rect
  /** The capsule. It encloses the circle at one end and holds the name and address at the other. */
  description: Rect
  follow: Rect
  offload: Rect
  remove: Rect
  /** Where the centre of the circle is on screen after clamping (it can move when the pin is near an edge). */
  circleCentre: Point
}

const box = (cx: number, cy: number, w: number, h: number): Rect => ({ x: cx - w / 2, y: cy - h / 2, width: w, height: h })

/** The resting window: just the circle and its shadow margin. */
export function restingBounds(centre: Point, d: number): Rect {
  const size = d + SHADOW_MARGIN * 2
  return { x: Math.round(centre.x - size / 2), y: Math.round(centre.y - size / 2), width: Math.round(size), height: Math.round(size) }
}

/** The side for the description: left by default, right when the left side has no room. Locked by the caller until the pin closes. */
export const pillWidth = (d: number): number => Math.max(PILL_MIN_WIDTH, d * PILL_WIDTH_FACTOR)

export function chooseSide(centre: Point, d: number, area: Rect): Side {
  const need = d / 2 + PILL_INSET + pillWidth(d) - d - PILL_INSET * 2 + PILL_INSET + SHADOW_MARGIN
  const roomLeft = centre.x - area.x
  const roomRight = area.x + area.width - centre.x
  if (roomLeft >= need) return 'left'
  if (roomRight >= need) return 'right'
  return roomLeft >= roomRight ? 'left' : 'right'
}

export function armedLayout(centre: Point, d: number, area: Rect, side: Side = chooseSide(centre, d, area)): PinLayout {
  const gap = GAP
  const b = Math.max(d * BUBBLE_FACTOR, BUBBLE_MIN)
  const pillW = Math.min(pillWidth(d), Math.max(d + PILL_INSET * 2, area.width - SHADOW_MARGIN * 2))
  const pillH = d + PILL_INSET * 2
  const dir = side === 'left' ? -1 : 1

  // Positions relative to the circle centre (0, 0). The capsule wraps the circle at one end and grows away from it.
  const circle = box(0, 0, d, d)
  const edge = d / 2 + PILL_INSET // the capsule's edge on the circle's side
  const description = box(-dir * (edge - pillW / 2), 0, pillW, pillH)

  // The room around the pin, from the circle's centre to the edge of the usable screen. Only the parts you see have to fit:
  // the see-through margin for the shadow may reach past the edge of the screen.
  const room = {
    left: centre.x - area.x, right: area.x + area.width - centre.x,
    top: centre.y - area.y, bottom: area.y + area.height - centre.y
  }
  const fits = (r: Rect) => r.x >= -room.left && r.x + r.width <= room.right && r.y >= -room.top && r.y + r.height <= room.bottom
  const apart = (r: Rect, others: Rect[]) =>
    others.every((o) => r.x >= o.x + o.width + 2 || o.x >= r.x + r.width + 2 || r.y >= o.y + o.height + 2 || o.y >= r.y + r.height + 2)

  // Places for a bubble. Normally Follow is on the far side of the circle, Offload below and Remove above. Near an edge or
  // a corner there is no room for that, so a bubble takes a free place in the row at either end of the capsule or the other
  // side. The circle never moves: the pointer stays on it.
  const far = (i: number) => box(-dir * (edge + gap + b / 2 + i * (b + gap)), 0, b, b)
  const end = (i: number) => box(dir * (pillW - edge + gap + b / 2 + i * (b + gap)), 0, b, b)
  const above = box(0, -(pillH / 2 + gap + b / 2), b, b)
  const below = box(0, pillH / 2 + gap + b / 2, b, b)
  const row = [far(0), end(0), far(1), end(1), far(2), end(2)]
  const placed: Rect[] = [circle, description]
  const place = (wanted: Rect[]): Rect => {
    const choice = wanted.find((r) => fits(r) && apart(r, placed)) ?? wanted.find((r) => apart(r, placed)) ?? wanted[0]!
    placed.push(choice)
    return choice
  }
  const follow = place([far(0), end(0), ...row, above, below])
  const offload = place([below, ...row, above])
  const remove = place([above, ...row, below])

  const parts = [circle, description, follow, offload, remove]
  // What you see (without the margin for the shadow) must be on the screen.
  const seenLeft = Math.min(...parts.map((r) => r.x))
  const seenTop = Math.min(...parts.map((r) => r.y))
  const seenWidth = Math.max(...parts.map((r) => r.x + r.width)) - seenLeft
  const seenHeight = Math.max(...parts.map((r) => r.y + r.height)) - seenTop
  const left = seenLeft - SHADOW_MARGIN
  const top = seenTop - SHADOW_MARGIN
  const width = seenWidth + SHADOW_MARGIN * 2
  const height = seenHeight + SHADOW_MARGIN * 2

  // The window keeps the circle where it is. Only if the group still does not fit (a very small screen) it is moved.
  let seenX = centre.x + seenLeft
  let seenY = centre.y + seenTop
  seenX = Math.min(Math.max(seenX, area.x), area.x + Math.max(0, area.width - seenWidth))
  seenY = Math.min(Math.max(seenY, area.y), area.y + Math.max(0, area.height - seenHeight))
  const x = Math.round(seenX) - SHADOW_MARGIN
  const y = Math.round(seenY) - SHADOW_MARGIN
  const circleCentre = { x: Math.round(x - left), y: Math.round(y - top) }
  const rel = (r: Rect): Rect => ({ x: r.x - left, y: r.y - top, width: r.width, height: r.height })
  return {
    descriptionSide: side,
    bounds: { x, y, width: Math.round(width), height: Math.round(height) },
    circle: rel(circle),
    description: rel(description),
    follow: rel(follow),
    offload: rel(offload),
    remove: rel(remove),
    circleCentre
  }
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

/** Is the pointer on the circle itself (not just inside the window rectangle)? Used to start arming. */
export function onCircle(circle: Rect, p: Point): boolean {
  const r = circle.width / 2
  return Math.hypot(p.x - (circle.x + r), p.y - (circle.y + r)) <= r
}

/**
 * Where a new pin goes: as close as possible to `want`, on screen, and not on top of another pin.
 * It tries the wanted place first, then a growing grid around it. If every place is taken it uses the wanted place.
 */
export function freeSpot(want: Point, others: Point[], d: number, area: Rect): Point {
  const margin = d / 2 + SHADOW_MARGIN / 2
  const clamp = (p: Point): Point => ({
    x: Math.round(Math.min(Math.max(p.x, area.x + margin), area.x + area.width - margin)),
    y: Math.round(Math.min(Math.max(p.y, area.y + margin), area.y + area.height - margin))
  })
  const step = d * 1.4
  const free = (p: Point) => others.every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= step)
  const first = clamp(want)
  if (free(first)) return first
  for (let ring = 1; ring <= 12; ring++) {
    const candidates: Point[] = []
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        candidates.push(clamp({ x: want.x + dx * step, y: want.y + dy * step }))
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - want.x, a.y - want.y) - Math.hypot(b.x - want.x, b.y - want.y))
    const hit = candidates.find(free)
    if (hit) return hit
  }
  return first
}
