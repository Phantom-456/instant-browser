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
    expect(source).not.toMatch(/^import (?!type )[^\n]*from '\./m) // no runtime imports of local files (type imports are erased)
    const consts = [...source.matchAll(/^const ([A-Z_]+) = '([^']+)'$/gm)]
    for (const [, name, value] of consts) {
      expect((ipc as Record<string, unknown>)[name!]).toBe(value)
    }
  })
}
