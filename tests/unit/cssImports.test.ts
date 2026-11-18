import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A CSS @import is ignored if anything but a comment or another @import comes before it. That once broke the whole Settings screen.
describe('style sheets', () => {
  it('start with their @import lines', () => {
    const root = join(__dirname, '../../src/renderer')
    for (const dir of readdirSync(root)) {
      const file = join(root, dir, 'style.css')
      if (!existsSync(file)) continue
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const at = css.indexOf('@import')
      if (at < 0) continue
      const before = css.slice(0, at).trim()
      expect(before, `${dir}/style.css: something comes before @import`).toBe('')
    }
  })
})
