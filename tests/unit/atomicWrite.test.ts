import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const failFsync = { on: false }
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    fsyncSync: (fd: number) => {
      if (failFsync.on) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      fs.fsyncSync(fd)
    }
  }
})

const { writeFileAtomic } = await import('../../src/main/atomicWrite')
const { SettingsFile } = await import('../../src/main/settingsFile')

const folder = () => mkdtempSync(join(tmpdir(), 'atomic-'))
afterEach(() => { failFsync.on = false })

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temporary file', () => {
    const dir = folder()
    const path = join(dir, 'sub', 'a.json')
    writeFileAtomic(path, '{"a":1}')
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}')
    expect(readdirSync(join(dir, 'sub'))).toEqual(['a.json'])
  })

  it('keeps the old file whole when the write fails', () => {
    const dir = folder()
    const path = join(dir, 'a.json')
    writeFileSync(path, 'old')
    failFsync.on = true
    expect(() => writeFileAtomic(path, 'new')).toThrow('disk full')
    expect(readFileSync(path, 'utf8')).toBe('old')
    expect(readdirSync(dir)).toEqual(['a.json'])
  })

  it.skipIf(process.platform === 'win32')('gives the file the mode asked for', () => {
    const path = join(folder(), 's')
    writeFileAtomic(path, Buffer.from([1, 2, 3]), { mode: 0o600 })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect([...readFileSync(path)]).toEqual([1, 2, 3])
  })
})

describe('settings file', () => {
  // Regression: a failed or interrupted save used to leave a half-written file, which the next start read as
  // broken and replaced with the defaults: every setting was lost.
  it('keeps the saved settings when a save fails half way', () => {
    const path = join(folder(), 'settings.json')
    new SettingsFile(path).update({ httpsFirst: false })
    failFsync.on = true
    expect(() => new SettingsFile(path).update({ sendGpc: false })).toThrow()
    failFsync.on = false
    expect(new SettingsFile(path).get().httpsFirst).toBe(false)
  })
})
