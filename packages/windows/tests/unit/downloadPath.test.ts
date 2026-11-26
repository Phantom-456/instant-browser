import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DownloadPaths } from '../../src/main/downloadPath'

describe('download save paths', () => {
  it('gives two downloads of the same name started together different paths', () => {
    // Regression: both used to get "report.pdf" because neither file exists until it finishes.
    const paths = new DownloadPaths(() => false)
    const a = paths.reserve('/d', 'report.pdf')
    const b = paths.reserve('/d', 'report.pdf')
    expect(a).toBe(join('/d', 'report.pdf'))
    expect(b).toBe(join('/d', 'report (1).pdf'))
  })

  it('ignores case, like the macOS and Windows file systems', () => {
    const paths = new DownloadPaths(() => false)
    paths.reserve('/d', 'Report.PDF')
    expect(paths.reserve('/d', 'report.pdf')).toBe(join('/d', 'report (1).pdf'))
  })

  it('frees a path once its download is done', () => {
    const paths = new DownloadPaths(() => false)
    const a = paths.reserve('/d', 'a.zip')
    paths.release(a)
    expect(paths.reserve('/d', 'a.zip')).toBe(a)
  })

  it('skips files already on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dl-'))
    writeFileSync(join(dir, 'x.txt'), '')
    writeFileSync(join(dir, 'x (1).txt'), '')
    expect(new DownloadPaths().reserve(dir, 'x.txt')).toBe(join(dir, 'x (2).txt'))
  })

  it('never hands out the same path twice while held (property check)', () => {
    const paths = new DownloadPaths(() => false)
    const names = ['a.pdf', 'A.pdf', 'a', '.hidden', 'a.tar.gz', 'a (1).pdf']
    const held = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const p = paths.reserve('/d', names[(i * 7) % names.length]!)
      expect(held.has(p.toLowerCase())).toBe(false)
      held.add(p.toLowerCase())
    }
  })
})
