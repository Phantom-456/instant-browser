import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

/**
 * Picks save paths for downloads: name.pdf, name (1).pdf, name (2).pdf ...
 *
 * A download is written to its path only when it finishes, so checking the disk alone is not enough:
 * two downloads of "report.pdf" started together would both get "report.pdf" and the second one to
 * finish would overwrite the first. Paths handed out stay reserved until `release` is called.
 * Names are compared without case, because the macOS and Windows file systems ignore case.
 */
export class DownloadPaths {
  private readonly reserved = new Set<string>()

  constructor(private readonly exists: (path: string) => boolean = existsSync) {}

  reserve(folder: string, filename: string): string {
    const ext = extname(filename)
    const stem = filename.slice(0, filename.length - ext.length)
    let path = join(folder, filename)
    for (let n = 1; this.taken(path); n++) path = join(folder, `${stem} (${n})${ext}`)
    this.reserved.add(path.toLowerCase())
    return path
  }

  release(path: string): void {
    this.reserved.delete(path.toLowerCase())
  }

  private taken(path: string): boolean {
    return this.reserved.has(path.toLowerCase()) || this.exists(path)
  }
}
