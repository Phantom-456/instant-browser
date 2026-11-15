import { expect, test } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as ipc from '../../src/shared/ipc'

// A sandboxed preload cannot import our own files, so each preload writes its channel names as text.
// This test makes sure those texts are the same as the names in src/shared/ipc.ts.
const dir = 'src/preload'
for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
  test(`${file}: channel names match ipc.ts`, () => {
    const source = readFileSync(join(dir, file), 'utf8')
    // No runtime imports of local files (type imports are erased). One exception: the swipe logic, which only page.ts uses,
    // so the build puts it inside page.js (checked below).
    expect(source).not.toMatch(/^import (?!type )(?![^\n]*from '\.\.\/shared\/swipe')[^\n]*from '\./m)
    const consts = [...source.matchAll(/^const ([A-Z_]+) = '([^']+)'$/gm)]
    for (const [, name, value] of consts) {
      expect((ipc as Record<string, unknown>)[name!]).toBe(value)
    }
  })
}

// A built preload must be one file: a sandboxed preload cannot load a second one.
test('the built page preload (when there is a build) loads nothing from our own files', () => {
  let built = ''
  try { built = readFileSync('out/preload/page.js', 'utf8') } catch { return }
  expect(built).not.toMatch(/require\(["']\.\.?\//)
})
