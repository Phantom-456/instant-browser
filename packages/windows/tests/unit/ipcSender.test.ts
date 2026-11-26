import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

// Every IPC message handler in the main process must check who sent it (event.sender, or a fromUs(event) helper).
// Otherwise any renderer, including a compromised web page, could drive it. Handlers passed by name are checked where
// they are written, so only inline handlers are read here.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : []
  })

for (const file of files('src/main')) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/ipcMain\.(?:on|handle)\(\s*([A-Z_]+)\s*,\s*(?:async\s*)?\(([^)]*)\)\s*=>/g)) {
    test(`${file}: ${match[1]} checks its sender`, () => {
      const start = match.index! + match[0].length
      const next = source.indexOf('ipcMain.', start)
      const body = source.slice(start, Math.min(next === -1 ? source.length : next, start + 400)) // this handler only
      expect(match[2]).not.toBe('') // the handler must take the event to check it
      expect(body).toMatch(/\.sender\b|fromUs\(/)
    })
  }
}
