import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { AgentBookmarkStore } from '../../src/main/agentBookmarkStore'
import { parseAgentFolders } from '../../src/shared/agentBookmarks'

/** A fixed agent for a name, like the one a key gives. */
const who = (name: string) => ({ id: `ag-${Buffer.from(name.trim().toLowerCase()).toString('hex').padEnd(12, '0').slice(0, 12)}`, name })

let dir = ''
let file = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-bm-')); file = join(dir, 'agent-bookmarks.json') })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('only the owner can add, names are unique per owner', () => {
  const s = new AgentBookmarkStore(file)
  const f = s.createFolder(who('Claude Code'), 'Research', false)
  expect(f.id).toMatch(/^af-[0-9a-f]{12}$/)
  expect(() => s.createFolder(who('Claude Code'), 'research', false)).toThrow('already have')
  const other = s.createFolder(who('Codex'), 'Research', false)
  expect(other.owner).toBe(who('Codex').id)
  expect(other.ownerName).toBe('Codex')
  expect(() => s.add(who('Codex'), f.id, 'https://a.example', '')).toThrow('Only the owner')
  expect(s.add(who('Claude Code'), f.id, 'https://a.example/#x', 'A').url).toBe('https://a.example/')
  expect(() => s.add(who('Claude Code'), f.id, 'ftp://nope', '')).toThrow('http')
  expect(() => s.createFolder(who('x'), '  ', false)).toThrow('1 to 80')
})

test('ownership is by id: the same name with another id is not the owner', () => {
  const s = new AgentBookmarkStore(file)
  const f = s.createFolder({ id: 'ag-aaaaaaaaaaaa', name: 'Codex' }, 'F', true)
  const faker = { id: 'ag-bbbbbbbbbbbb', name: 'Codex' }
  expect(() => s.add(faker, f.id, 'https://a.example', '')).toThrow('Only the owner')
  expect(() => s.deleteFolder(faker, f.id)).toThrow('Only the owner')
  expect(s.folders()).toHaveLength(1)
})

test('an old folder that holds a name is never claimed by name, only by the old key', () => {
  writeFileSync(file, JSON.stringify({ version: 1, folders: [{ id: 'af-1', name: 'Old', owner: 'Codex', allowDelete: true, createdAt: 1, items: [] }, { id: 'af-2', name: 'Mine', owner: 'ag-cccccccccccc', ownerName: 'Claude', allowDelete: true, createdAt: 1, items: [] }] }))
  const s = new AgentBookmarkStore(file)
  expect(s.folder('af-1').ownerName).toBe('Codex')
  // A new agent that is given the old name gets nothing: names can be chosen freely.
  const sameName = { id: 'ag-bbbbbbbbbbbb', name: 'codex' }
  expect(s.mine(s.folder('af-1'), sameName)).toBe(false)
  expect(() => s.add(sameName, 'af-1', 'https://a.example', '')).toThrow('Only the owner')
  expect(() => s.deleteFolder(sameName, 'af-1')).toThrow('Only the owner')
  // No agent holds the old key: the folder stays unowned.
  expect(s.adoptLegacy(null)).toBe(0)
  expect(s.folder('af-1').owner).toBe('Codex')
  // The agent that holds the old key gets the old folders, once; folders that already have an id are left alone.
  const legacy = { id: 'ag-aaaaaaaaaaaa', name: 'Default' }
  expect(s.adoptLegacy(legacy)).toBe(1)
  expect(s.folder('af-1')).toMatchObject({ owner: 'ag-aaaaaaaaaaaa', ownerName: 'Default' })
  expect(s.folder('af-2').owner).toBe('ag-cccccccccccc')
  expect(new AgentBookmarkStore(file).folder('af-1').owner).toBe('ag-aaaaaaaaaaaa')
  expect(s.adoptLegacy(legacy)).toBe(0)
  s.add(legacy, 'af-1', 'https://a.example', '')
  expect(s.userRemoveFolder('af-1')).toBe(true)
})

test('the same address twice gives the same item', () => {
  const s = new AgentBookmarkStore(file)
  const f = s.createFolder(who('a'), 'F', false)
  const one = s.add(who('a'), f.id, 'https://a.example', 'One')
  expect(s.add(who('a'), f.id, 'https://a.example/#top', 'Two')).toEqual(one)
  expect(s.folder(f.id).items).toHaveLength(1)
})

test('remove needs the owner and allowDelete', () => {
  const s = new AgentBookmarkStore(file)
  const f = s.createFolder(who('a'), 'F', false)
  const b = s.add(who('a'), f.id, 'https://a.example', '')
  expect(() => s.remove(who('a'), f.id, b.id)).toThrow('does not allow deletion')
  expect(() => s.deleteFolder(who('a'), f.id)).toThrow('does not allow deletion')
  s.userSetPermission(f.id, true) // only the person can change it after creation
  expect(() => s.remove(who('other'), f.id, b.id)).toThrow('Only the owner')
  expect(() => s.remove(who('a'), f.id, 'nope')).toThrow('No bookmark')
  s.remove(who('a'), f.id, b.id)
  expect(s.folder(f.id).items).toHaveLength(0)
  s.deleteFolder(who('a'), f.id)
  expect(s.folders()).toHaveLength(0)
  expect(() => s.folder(f.id)).toThrow('No agent folder')
})

test('the person can always remove a folder', () => {
  const s = new AgentBookmarkStore(file)
  const f = s.createFolder(who('a'), 'F', false)
  expect(s.userRemoveFolder(f.id)).toBe(true)
  expect(s.userRemoveFolder(f.id)).toBe(false)
})

test('the person can always remove one page, even from a folder that does not allow deletion', () => {
  const s = new AgentBookmarkStore(file)
  const f = s.createFolder(who('a'), 'F', false)
  const one = s.add(who('a'), f.id, 'https://a.example', 'A')
  s.add(who('a'), f.id, 'https://b.example', 'B')
  expect(s.userRemoveItem(f.id, 'nope')).toBe(false)
  expect(s.userRemoveItem('nope', one.id)).toBe(false)
  expect(s.userRemoveItem(f.id, one.id)).toBe(true)
  expect(s.folder(f.id).items.map((b) => b.title)).toEqual(['B'])
  expect(new AgentBookmarkStore(file).folder(f.id).items).toHaveLength(1) // saved
})

test('saved to a private file and read back; a broken file gives an empty store', () => {
  const s = new AgentBookmarkStore(file)
  let changes = 0
  s.onChange = () => { changes++ }
  const f = s.createFolder(who('a'), 'F', true)
  s.add(who('a'), f.id, 'https://a.example', 'A')
  expect(changes).toBe(2)
  expect(statSync(file).mode & 0o777).toBe(0o600)
  const again = new AgentBookmarkStore(file)
  expect(again.folders()).toEqual(s.folders())
  writeFileSync(file, '{ not json')
  expect(new AgentBookmarkStore(file).folders()).toEqual([])
  expect(readFileSync(file, 'utf8')).toBe('{ not json')
})

test('limits and invalid entries', () => {
  const s = new AgentBookmarkStore(file)
  expect(() => s.createFolder(who('a'), 'x'.repeat(81), false)).toThrow('1 to 80')
  for (let i = 0; i < 100; i++) s.createFolder(who('a'), `f${i}`, false)
  expect(() => s.createFolder(who('a'), 'one more', false)).toThrow('100')
  const parsed = parseAgentFolders([
    { id: 'af-1', name: ' ok ', owner: 'a', items: [{ url: 'https://x.example', title: 't'.repeat(500) }, { url: 'javascript:1' }, 5] },
    { id: 'af-1', name: 'dup', owner: 'a' }, { id: 'af-2', name: '', owner: 'a' }, { id: 'af-3', name: 'n', owner: ' ' }, null, 'x'
  ])
  expect(parsed).toHaveLength(1)
  expect(parsed[0]!.name).toBe('ok')
  expect(parsed[0]!.allowDelete).toBe(false)
  expect(parsed[0]!.items).toHaveLength(1)
  expect(parsed[0]!.items[0]!.title).toHaveLength(300)
  expect(parseAgentFolders('nope')).toEqual([])
})

test('a folder holds at most 1000 pages', () => {
  const s = new AgentBookmarkStore(file)
  const f = s.createFolder(who('a'), 'F', false)
  f.items.push(...Array.from({ length: 1000 }, (_, i) => ({ id: `bm-${i}`, url: `https://x.example/${i}`, title: 't', createdAt: 0 })))
  expect(() => s.add(who('a'), f.id, 'https://new.example', '')).toThrow('full')
})
