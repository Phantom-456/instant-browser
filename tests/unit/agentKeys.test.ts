import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { AgentKeys } from '../../src/main/mcp/agentKeys'

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-keys-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('a fresh folder gets a Default agent with a private file', () => {
  const k = new AgentKeys(dir)
  const only = k.list()[0]!
  expect(k.list()).toHaveLength(1)
  expect(only).toMatchObject({ name: 'Default' })
  expect(only.id).toMatch(/^ag-[0-9a-f]{12}$/)
  expect(only.key).toMatch(/^[0-9a-f]{64}$/)
  if (process.platform !== 'win32') expect(statSync(join(dir, 'mcp-agents.json')).mode & 0o777).toBe(0o600)
  expect(new AgentKeys(dir).list()).toEqual(k.list()) // kept on disk
})

test('add, byKey, rotate and remove', () => {
  const k = new AgentKeys(dir)
  const a = k.add('  Codex ')
  expect(a.name).toBe('Codex')
  expect(k.byKey(a.key)).toMatchObject({ id: a.id, name: 'Codex' })
  expect(k.byKey(k.list()[0]!.key)?.name).toBe('Default')
  expect(k.byKey('nope')).toBeNull()
  expect(k.byKey('')).toBeNull()
  expect(k.byKey(a.key.slice(0, 63))).toBeNull()
  const rotated = k.rotate(a.id)!
  expect(rotated.key).not.toBe(a.key)
  expect(k.byKey(a.key)).toBeNull()
  expect(k.byKey(rotated.key)?.id).toBe(a.id)
  expect(k.rotate('ag-000000000000')).toBeNull()
  expect(k.remove(a.id)).toBe(true)
  expect(k.remove(a.id)).toBe(false)
  expect(k.byKey(rotated.key)).toBeNull()
  expect(new AgentKeys(dir).list().map((x) => x.name)).toEqual(['Default'])
})

test('names are 1 to 40 characters and unique ignoring case', () => {
  const k = new AgentKeys(dir)
  expect(() => k.add('  ')).toThrow('1 to 40')
  expect(() => k.add('x'.repeat(41))).toThrow('1 to 40')
  k.add('Codex')
  expect(() => k.add('codex')).toThrow('already exists')
  expect(() => k.add(' DEFAULT ')).toThrow('already exists')
})

test('at most 20 agents', () => {
  const k = new AgentKeys(dir)
  for (let i = 1; i < 20; i++) k.add(`agent ${i}`)
  expect(k.list()).toHaveLength(20)
  expect(() => k.add('one more')).toThrow('20')
})

test('the old mcp-key becomes the Default agent and is left in place', () => {
  const old = 'ab'.repeat(32)
  writeFileSync(join(dir, 'mcp-key'), old)
  const k = new AgentKeys(dir)
  expect(k.list()).toHaveLength(1)
  expect(k.list()[0]).toMatchObject({ name: 'Default', key: old })
  expect(k.byKey(old)?.name).toBe('Default')
  expect(existsSync(join(dir, 'mcp-key'))).toBe(true)
  expect(readFileSync(join(dir, 'mcp-key'), 'utf8')).toBe(old)
})

test('an invalid old key is not imported, and an existing agents file wins over the old key', () => {
  writeFileSync(join(dir, 'mcp-key'), 'short')
  const first = new AgentKeys(dir)
  expect(first.list()[0]!.key).not.toBe('short')
  writeFileSync(join(dir, 'mcp-key'), 'cd'.repeat(32))
  expect(new AgentKeys(dir).list()).toEqual(first.list())
})

test('legacyAgent is the agent that still holds the old one-key key', () => {
  const old = 'a'.repeat(64)
  writeFileSync(join(dir, 'mcp-key'), old)
  const k = new AgentKeys(dir)
  const first = k.list()[0]!
  expect(k.legacyAgent()?.id).toBe(first.id)
  k.add('Default 2')
  expect(k.legacyAgent()?.id).toBe(first.id)
  k.rotate(first.id) // a new key for it: the old key no longer belongs to anyone
  expect(k.legacyAgent()).toBeNull()
})

test('legacyAgent is null without an old key file', () => {
  expect(new AgentKeys(dir).legacyAgent()).toBeNull()
})
