import { expect, test } from 'vitest'
test('test runner works', () => { expect(1 + 1).toBe(2) })

// The Windows app must not tell people to press Mac keys.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
test('no Mac key names in text the Windows app shows', () => {
  const dir = join(__dirname, '../../src/renderer')
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
  const shown = /'[^'\n]*\b(Command|Cmd|Option)(\+| (comma|Shift|Option|Return)\b)[^'\n]*'/ // "Command Prompt" is fine
  for (const file of files) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//'))
    for (const line of lines) expect(line, `${file}: ${line.trim()}`).not.toMatch(shown)
  }
})

test('text the Windows app shows does not speak of macOS as if it were this system', () => {
  const dir = join(__dirname, '../../src/renderer')
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
  // Allowed: text only shown on a Mac (the manager's darwin branch), and plain comparisons with a Mac.
  const allowed = [/platform === 'darwin'/, /on a Mac/, /^\s*\?\s*'Desktops: macOS/]
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (line.trim().startsWith('//') || line.trim().startsWith('*') || !/'[^'\n]*macOS[^'\n]*'/.test(line)) continue
      expect(allowed.some((ok) => ok.test(line)), `${file}: ${line.trim()}`).toBe(true)
    }
  }
})

test('main process text does not send Windows users to the Mac menu bar or Dock', () => {
  const dir = join(__dirname, '../../src/main')
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
  const shown = /['`"][^'`"\n]*\b(menu bar|Dock|Finder|System Settings)\b[^'`"\n]*['`"]/
  for (const file of files) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
    for (const line of lines) expect(line, `${file}: ${line.trim()}`).not.toMatch(shown)
  }
})
