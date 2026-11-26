import type { RawVisit } from './history'

export interface FileSignature { size: number; mtimeMs: number }

/** The rows read from one history file last time, with the file's size and time then. */
export interface CachedFile {
  path: string
  source: string
  sig: FileSignature
  rows: RawVisit[]
}

export interface FoundFile { path: string; source: string; sig: FileSignature }

export function sameSignature(a: FileSignature | undefined, b: FileSignature | undefined): boolean {
  return !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs
}

/**
 * Decide what to do with each history file: use the saved rows when the file is the same as before,
 * read it again when it changed or is new. Files that are gone are dropped.
 */
export function planScan(found: FoundFile[], cache: CachedFile[]): { reuse: CachedFile[]; read: FoundFile[] } {
  const byPath = new Map(cache.map((c) => [c.path, c]))
  const reuse: CachedFile[] = []
  const read: FoundFile[] = []
  for (const file of found) {
    const old = byPath.get(file.path)
    if (old && sameSignature(old.sig, file.sig)) reuse.push(old)
    else read.push(file)
  }
  return { reuse, read }
}

/**
 * The cache entries after reading the changed files. `rows` is null when a file could not be read (the browser was
 * writing it, it was locked, or it is in a new format). Such a file keeps the rows from last time, under its OLD
 * signature, so the next scan tries it again. A failed read must never be saved as "this browser has no history":
 * that emptied a browser from the search bar until it next wrote to its history.
 */
export function settleReads(read: Array<{ file: FoundFile; rows: RawVisit[] | null }>, cache: CachedFile[]): CachedFile[] {
  const byPath = new Map(cache.map((c) => [c.path, c]))
  return read.flatMap(({ file, rows }) => {
    if (rows) return [{ ...file, rows }]
    const old = byPath.get(file.path)
    return old ? [old] : []
  })
}
