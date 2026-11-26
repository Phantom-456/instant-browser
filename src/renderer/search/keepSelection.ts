/**
 * Where the highlighted row is after the list was drawn again (newer history arrived in the background).
 * The row is found again by what it is, not by its position: new history can add or move rows above it, and
 * keeping the position would move the highlight to another row, so Enter would open a page the user did not pick.
 * -1 when that row is no longer in the list.
 */
export function sameItemIndex<T extends { type: string; value: string }>(items: readonly T[], kept: T | undefined): number {
  if (!kept) return -1
  return items.findIndex((item) => item.type === kept.type && item.value === kept.value)
}
