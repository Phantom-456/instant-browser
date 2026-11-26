import { afterAll, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { availableSources, readSource, tryReadHistoryFile } from '../../src/main/historyReader'

// Made-up history files. No real user data.
const root = mkdtempSync(join(tmpdir(), 'ib-hist-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function makeChromium(dir: string): void {
  mkdirSync(join(dir, 'Default'), { recursive: true })
  const db = new DatabaseSync(join(dir, 'Default', 'History'))
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER)')
  const add = db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)')
  // 13439189312492269 microseconds since 1601 is too big for a JavaScript number. It is a real size.
  add.run('https://www.google.com/search?q=made+up+words', 'made up words - Google Search', 2, 13439189312492269n, 0)
  add.run('https://docs.example.com/page', 'Example docs', 5, 13439189312492269n - 86_400_000_000n, 0)
  add.run('https://hidden.example.com/', 'Hidden', 1, 13439189312492269n, 1)
  db.close()
}
function makeFirefox(dir: string): void {
  mkdirSync(join(dir, 'abc.default'), { recursive: true })
  const db = new DatabaseSync(join(dir, 'abc.default', 'places.sqlite'))
  db.exec('CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER)')
  db.prepare('INSERT INTO moz_places (url, title, visit_count, last_visit_date) VALUES (?, ?, ?, ?)').run('https://fox.example.com/', 'Fox page', 3, 1_763_000_000_000_000)
  db.prepare('INSERT INTO moz_places (url, title, visit_count, last_visit_date) VALUES (?, ?, ?, ?)').run('https://never.example.com/', 'Never visited', 0, null)
  db.close()
}

test('a Chromium history file is read, with its huge timestamps, and hidden rows are left out', () => {
  const dir = join(root, 'chromium')
  makeChromium(dir)
  const rows = readSource({ name: 'Test Chromium', kind: 'chromium', dir })
  expect(rows.map((r) => r.url).sort()).toEqual(['https://docs.example.com/page', 'https://www.google.com/search?q=made+up+words'])
  const search = rows.find((r) => r.url.includes('google'))!
  // 13439189312492269 us since 1601 is 2026-11-1x. Check the year.
  expect(new Date(search.lastVisit).getUTCFullYear()).toBe(2026)
  expect(search).toMatchObject({ visits: 2, source: 'Test Chromium' })
  const older = rows.find((r) => r.url.includes('docs'))!
  expect(search.lastVisit - older.lastVisit).toBe(86_400_000)
})

test('a Firefox history file is read, and pages that were never visited are left out', () => {
  const dir = join(root, 'firefox')
  makeFirefox(dir)
  const rows = readSource({ name: 'Test Firefox', kind: 'firefox', dir })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ url: 'https://fox.example.com/', title: 'Fox page', visits: 3, source: 'Test Firefox' })
  expect(rows[0]!.lastVisit).toBe(1_763_000_000_000)
})

test('a missing folder or a broken file gives no rows and no error', () => {
  expect(readSource({ name: 'None', kind: 'chromium', dir: join(root, 'does-not-exist') })).toEqual([])
  const dir = join(root, 'broken')
  mkdirSync(join(dir, 'Default'), { recursive: true })
  const db = new DatabaseSync(join(dir, 'Default', 'History')); db.exec('CREATE TABLE other (a)'); db.close()
  expect(readSource({ name: 'Broken', kind: 'chromium', dir })).toEqual([])
})

test('available sources are the ones that have a history file', () => {
  process.env.INSTANT_TEST = '1'
  process.env.INSTANT_TEST_HISTORY = JSON.stringify([
    { name: 'Has', kind: 'chromium', dir: join(root, 'chromium') },
    { name: 'Missing', kind: 'chromium', dir: join(root, 'nope') }
  ])
  expect(availableSources()).toEqual(['Has'])
  delete process.env.INSTANT_TEST
  delete process.env.INSTANT_TEST_HISTORY
})

test('a half-written or unknown history file reads as "could not read" (null), not as "no history"', () => {
  const file = join(root, 'broken-History')
  writeFileSync(file, 'SQLite format 3\0' + 'x'.repeat(200)) // a torn copy
  expect(tryReadHistoryFile(file, { name: 'B', kind: 'chromium', dir: root })).toBeNull()
  expect(tryReadHistoryFile(join(root, 'missing'), { name: 'B', kind: 'chromium', dir: root })).toBeNull()
})
