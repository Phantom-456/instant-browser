import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { OncePerOpening } from '../../src/main/onceOpen'

test('the open work runs once per opening, whether show() or the show event comes first', () => {
  const o = new OncePerOpening()
  let runs = 0
  o.add(() => { runs++ })
  o.open() // SearchBar.show()
  o.open() // the 'show' event, later
  expect(runs).toBe(1)
  o.closed()
  o.open()
  expect(runs).toBe(2)
})

test('it runs even when the show event never comes (Mac with the screen locked)', () => {
  const o = new OncePerOpening()
  const seen: string[] = []
  o.add(() => seen.push('refresh history'))
  o.add(() => seen.push('show bubbles'))
  o.open() // only SearchBar.show(); no event
  expect(seen).toEqual(['refresh history', 'show bubbles'])
})

test('SearchBar.show() runs the open work itself, not only from the show event', () => {
  const src = readFileSync(join(__dirname, '../../src/main/searchBar.ts'), 'utf8')
  const show = src.slice(src.indexOf('  show(): void {'), src.indexOf('  hide(): void {'))
  expect(show).toContain('this.opened.open()')
  // After focus(): showing the bubbles before the bar has the keyboard closed the bar again on the Mac.
  expect(show.indexOf('this.opened.open()')).toBeGreaterThan(show.indexOf('win.focus()'))
  expect(src).not.toMatch(/win\.on\('show', \(\) => this\.deps\.onShow\(\)\)/)
})
