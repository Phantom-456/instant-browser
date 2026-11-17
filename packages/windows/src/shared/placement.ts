export interface Rect { x: number; y: number; width: number; height: number }

/** Put a new window near the cursor, fully inside the screen's work area. */
export function placeNear(
  cursor: { x: number; y: number },
  size: { width: number; height: number },
  area: Rect
): Rect {
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
  return {
    x: clamp(cursor.x - Math.round(width / 2), area.x, area.x + area.width - width),
    y: clamp(cursor.y - 40, area.y, area.y + area.height - height),
    width,
    height
  }
}
