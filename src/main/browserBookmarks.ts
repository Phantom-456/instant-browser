import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseChromiumBookmarks, parseFirefoxBookmarks, type BrowserMark, type FirefoxRow } from '../shared/browserBookmarks'
import { isChromiumProfileDir, type HistorySource } from '../shared/historyPaths'

/** The profile folders of one browser. Chromium: "Default", "Profile 1"... Firefox: every folder under "Profiles". */
export function profileDirs(source: HistorySource): string[] {
  if (!existsSync(source.dir)) return []
  try {
    const dirs = readdirSync(source.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    return (source.kind === 'chromium' ? dirs.filter(isChromiumProfileDir) : dirs).map((d) => join(source.dir, d))
  } catch {
    return []
  }
}

/** The bookmark file of one profile (Chromium "Bookmarks", Firefox "places.sqlite"), or null when it has none. */
export function bookmarkFile(source: HistorySource, profile: string): string | null {
  const file = join(profile, source.kind === 'chromium' ? 'Bookmarks' : 'places.sqlite')
  return existsSync(file) ? file : null
}

/** Read one browser's bookmarks. The file is only read (a Firefox database is read from a copy). Never throws. */
export function readBrowserMarks(source: HistorySource): { marks: BrowserMark[]; ok: boolean } {
  const out: BrowserMark[] = []
  let ok = false
  for (const profile of profileDirs(source)) {
    const file = bookmarkFile(source, profile)
    if (!file) continue
    try {
      if (source.kind === 'chromium') {
        const text = readFileSync(file, 'utf8')
        JSON.parse(text) // a half-written file throws here, so it counts as unreadable and the old list stays
        out.push(...parseChromiumBookmarks(text, source.name))
      } else {
        out.push(...readFirefox(file, source.name))
      }
      ok = true
    } catch {
      /* locked, a new format, or no access: skip this profile */
    }
  }
  return { marks: out, ok }
}

function readFirefox(file: string, name: string): BrowserMark[] {
  const tmp = mkdtempSync(join(tmpdir(), 'ib-marks-'))
  try {
    const copy = join(tmp, 'p.sqlite')
    copyFileSync(file, copy)
    if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${copy}-wal`)
    const db = new DatabaseSync(copy)
    try {
      const rows = db
        .prepare('SELECT b.id AS id, b.type AS type, b.parent AS parent, b.title AS title, p.url AS url, b.dateAdded AS dateAdded, b.guid AS guid FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id')
        .all() as unknown as FirefoxRow[]
      return parseFirefoxBookmarks(rows, name)
    } finally {
      db.close()
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
