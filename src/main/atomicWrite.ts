import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Writes a whole file or nothing. The data goes to a temporary file next to the target, is flushed to the disk, and
 * then replaces the target in one rename. A crash, a full disk or a power cut in the middle leaves the old file as it
 * was, never half of it. (A half-written settings file used to be read as "broken" and silently reset to defaults.)
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, options: { mode?: number } = {}): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  try {
    const fd = openSync(tmp, 'w', options.mode ?? 0o666)
    try {
      for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at, bytes.length - at)
      fsyncSync(fd) // on the disk before the rename, or a power cut can leave an empty file under the real name
    } finally {
      closeSync(fd)
    }
    if (options.mode !== undefined) {
      try { chmodSync(tmp, options.mode) } catch { /* not supported on this system */ }
    }
    renameReplacing(tmp, path)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* nothing more to do */ }
    throw error
  }
}

/**
 * On Windows a rename onto a file fails for a moment while another program (an antivirus scan, the search indexer)
 * has that file open. Try again a few times before giving up, as graceful-fs does.
 */
function renameReplacing(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'win32' || attempt >= 6 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * attempt) // a short, blocking pause
    }
  }
}
