import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { pinTools } from '../../src/main/mcp/pinTools'
import { windowTools } from '../../src/main/mcp/windowTools'

// Agents never change the person's own bookmarks, history or pins. The tools are built so they cannot: no file in the MCP
// folder brings in the stores that hold them, so a tool has no way to write there.
const MCP_DIRS = ['src/main/mcp', 'src/shared/mcp']
const FORBIDDEN = [/bookmarkStore['"]/, /ownHistory['"]/, /pins\/pinStore['"]/, /historyIndex['"]/, /sync\//]

test('no MCP file imports a store of the person\'s own data', () => {
  for (const dir of MCP_DIRS) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const imports = readFileSync(join(dir, name), 'utf8').split('\n').filter((line) => /^\s*import\b/.test(line))
      for (const line of imports) for (const bad of FORBIDDEN) expect(line, `${dir}/${name}`).not.toMatch(bad)
    }
  }
})

test('the read tools get list functions only', () => {
  const text = readFileSync('src/main/mcp/tools.ts', 'utf8')
  const deps = /export interface BrowserToolDeps \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? ''
  const keys = [...deps.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
  expect(keys.sort()).toEqual(['archivedPins', 'bookmarks', 'browserMarks', 'downloads', 'history', 'pins', 'sitePermissions', 'tabs', 'windows'])
})

test('agents can never delete a pin', () => {
  for (const name of readdirSync('src/main/mcp').filter((n) => n.endsWith('.ts'))) {
    expect(readFileSync(join('src/main/mcp', name), 'utf8'), name).not.toContain('deleteForever')
  }
  const text = readFileSync('src/main/mcp/pinTools.ts', 'utf8')
  const deps = /export interface PinToolDeps \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? ''
  const keys = [...deps.matchAll(/^\s*(\w+)\(/gm)].map((m) => m[1] ?? '')
  expect(keys.sort()).toEqual(['archive', 'archivedPins', 'collapse', 'maxPins', 'pins', 'rename', 'unarchive'])
  expect(keys.some((k) => /delete|remove/i.test(k))).toBe(false)
})

test('no tool name has delete_pin', () => {
  const noop = () => []
  const names = [
    ...pinTools({ pins: noop, archivedPins: noop, maxPins: () => 1, collapse: () => false, rename: async () => {}, archive: async () => {}, unarchive: async () => {} }),
    ...windowTools({ open: () => null, close: () => false, windows: noop, show: () => false, navigate: () => false, step: () => null, reload: () => false, pins: noop, pinAct: async () => {} })
  ].map((t) => t.name)
  expect(names.length).toBeGreaterThan(0)
  for (const n of names) expect(n).not.toContain('delete_pin')
})
