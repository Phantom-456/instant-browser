import { expect, test } from 'vitest'
import { sameItemIndex } from '../../src/renderer/search/keepSelection'

const page = (url: string) => ({ type: 'page', value: url })

// Regression: when newer history arrived while a row was highlighted, the bar kept the row's position, not the row.
// A new page above it moved the highlight to another page, and Enter opened that one.
test('the highlighted row is found again by what it is, after new rows are added above it', () => {
  const before = [page('https://a.test/'), page('https://bank.test/'), page('https://c.test/')]
  const kept = before[1]
  const after = [page('https://new.test/'), ...before]
  expect(sameItemIndex(after, kept)).toBe(2)
  expect(after[sameItemIndex(after, kept)]).toEqual(kept)
})

test('nothing is highlighted when the row is gone, or nothing was highlighted', () => {
  expect(sameItemIndex([page('https://a.test/')], page('https://gone.test/'))).toBe(-1)
  expect(sameItemIndex([page('https://a.test/')], undefined)).toBe(-1)
})

test('a search and a page with the same text are different rows', () => {
  const items = [{ type: 'page', value: 'x' }, { type: 'search', value: 'x' }]
  expect(sameItemIndex(items, { type: 'search', value: 'x' })).toBe(1)
})
