import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHROMIUM_EPOCH_MS, type RawVisit } from '../shared/history'
import { historySources, isChromiumProfileDir, type HistorySource } from '../shared/historyPaths'
import { isTestMode } from './testMode'

const ROWS_PER_FILE = 1500

/** The browsers to read. In tests the list can be replaced, so a test never reads real history. */
export function configuredSources(): HistorySource[] {
  if (isTestMode()) {
    try {
      return JSON.parse(process.env.INSTANT_TEST_HISTORY ?? '[]') as HistorySource[]
    } catch {
      return []
    }
  }
  return historySources(process.platform, homedir(), process.env)
}

/** The history files of one browser: a Chromium "History" file per profile, a Firefox "places.sqlite" per profile. */
export function listHistoryFiles(source: HistorySource): string[] {
  if (!existsSync(source.dir)) return []
  try {
    const dirs = readdirSync(source.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    if (source.kind === 'chromium') {
      return dirs.filter(isChromiumProfileDir).map((d) => join(source.dir, d, 'History')).filter(existsSync)
    }
    return dirs.map((d) => join(source.dir, d, 'places.sqlite')).filter(existsSync)
  } catch {
    return []
  }
}

/** Browsers that have a history file we can read. */
export function availableSources(): string[] {
  return configuredSources().filter((s) => listHistoryFiles(s).length > 0).map((s) => s.name)
}

/**
 * Read rows from one history file. The browser may have the file locked, so a copy is read and then deleted.
 * Nothing is kept on disk and nothing is sent anywhere.
 */
export function readHistoryFile(file: string, source: HistorySource): RawVisit[] {
  const tmp = mkdtempSync(join(tmpdir(), 'ib-history-'))
  try {
    const copy = join(tmp, 'h.sqlite')
    copyFileSync(file, copy)
    // Firefox keeps recent visits in a "-wal" file next to the database. Copy it too.
    if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${copy}-wal`)
    const db = new DatabaseSync(copy)
    try {
      const rows =
        source.kind === 'chromium'
          ? (db
              .prepare('SELECT url, title, visit_count AS visits, CAST(last_visit_time / 1000 AS INTEGER) AS t FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?')
              .all(ROWS_PER_FILE) as Array<{ url: string; title: string | null; visits: number; t: number }>)
          : (db
              .prepare('SELECT url, title, visit_count AS visits, last_visit_date AS t FROM moz_places WHERE visit_count > 0 AND last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT ?')
              .all(ROWS_PER_FILE) as Array<{ url: string; title: string | null; visits: number; t: number }>)
      return rows.map((r) => ({
        url: String(r.url),
        title: r.title ?? '',
        visits: Number(r.visits) || 1,
        // Chromium time is microseconds since 1601. It is divided in SQL, because the raw number is too big for JavaScript.
        lastVisit: source.kind === 'chromium' ? Number(r.t) - CHROMIUM_EPOCH_MS : Number(r.t) / 1000,
        source: source.name
      }))
    } finally {
      db.close()
    }
  } catch {
    return [] // locked, new format, or no access: skip this file
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function readSource(source: HistorySource): RawVisit[] {
  return listHistoryFiles(source).flatMap((file) => readHistoryFile(file, source))
}
