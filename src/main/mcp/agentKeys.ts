import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../atomicWrite'

export interface AgentKey { id: string; name: string; key: string; createdAt: number }

export const MAX_AGENTS = 20
export const MAX_AGENT_NAME = 40
const KEY_PATTERN = /^[0-9a-f]{64}$/

/**
 * The agents allowed to connect, each with its own key (`<dir>/mcp-agents.json`, readable only by you).
 * Who an agent is comes from its key, so one agent cannot act as another.
 */
export class AgentKeys {
  private readonly path: string
  private agents: AgentKey[] = []

  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {
    this.path = join(dir, 'mcp-agents.json')
    if (existsSync(this.path)) {
      try { this.agents = parse(JSON.parse(readFileSync(this.path, 'utf8'))); return } catch { /* a broken file is not trusted: start again below */ }
    }
    // First run after the one-key version: the old key becomes the "Default" agent, so set-ups keep working.
    let old = ''
    try { old = readFileSync(join(dir, 'mcp-key'), 'utf8').trim() } catch { /* no old key */ }
    this.agents = [{ id: newId(), name: 'Default', key: KEY_PATTERN.test(old) ? old : newKey(), createdAt: now() }]
    this.save()
  }

  list(): AgentKey[] { return this.agents.map((a) => ({ ...a })) }

  /** The agent that still holds the key of the one-key version (the old `mcp-key` file, left in place), if any. */
  legacyAgent(): AgentKey | null {
    let old = ''
    try { old = readFileSync(join(this.dir, 'mcp-key'), 'utf8').trim() } catch { return null }
    if (!KEY_PATTERN.test(old)) return null
    const a = this.agents.find((x) => x.key === old)
    return a ? { ...a } : null
  }

  get(id: string): AgentKey | null {
    const a = this.agents.find((x) => x.id === id)
    return a ? { ...a } : null
  }

  add(name: string): AgentKey {
    const clean = typeof name === 'string' ? name.trim() : ''
    if (clean.length < 1 || clean.length > MAX_AGENT_NAME) throw new Error(`The agent name must be 1 to ${MAX_AGENT_NAME} characters.`)
    if (this.agents.length >= MAX_AGENTS) throw new Error(`There are already ${MAX_AGENTS} agents. Remove one first.`)
    if (this.agents.some((a) => a.name.toLowerCase() === clean.toLowerCase())) throw new Error(`An agent named "${clean}" already exists.`)
    const agent: AgentKey = { id: newId(), name: clean, key: newKey(), createdAt: this.now() }
    this.agents.push(agent)
    this.save()
    return { ...agent }
  }

  remove(id: string): boolean {
    const before = this.agents.length
    this.agents = this.agents.filter((a) => a.id !== id)
    if (this.agents.length === before) return false
    this.save()
    return true
  }

  /** Make a new key for one agent. Its old key stops working. */
  rotate(id: string): AgentKey | null {
    const a = this.agents.find((x) => x.id === id)
    if (!a) return null
    a.key = newKey()
    this.save()
    return { ...a }
  }

  /** The agent that owns this key, or null. Every key is compared, in constant time for each. */
  byKey(key: string): AgentKey | null {
    const given = Buffer.from(typeof key === 'string' ? key : '')
    let found: AgentKey | null = null
    for (const a of this.agents) {
      const have = Buffer.from(a.key)
      if (have.length === given.length && timingSafeEqual(have, given)) found = a
    }
    return found ? { ...found } : null
  }

  private save(): void {
    writeFileAtomic(this.path, JSON.stringify(this.agents), { mode: 0o600 })
  }
}

const newId = (): string => `ag-${randomBytes(6).toString('hex')}`
const newKey = (): string => randomBytes(32).toString('hex')

function parse(raw: unknown): AgentKey[] {
  if (!Array.isArray(raw)) throw new Error('not a list')
  const out: AgentKey[] = []
  for (const r of raw as Array<Partial<AgentKey> | null>) {
    if (!r || typeof r.id !== 'string' || !/^ag-[0-9a-f]{12}$/.test(r.id) || typeof r.key !== 'string' || !KEY_PATTERN.test(r.key)) continue
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (name.length < 1 || name.length > MAX_AGENT_NAME) continue
    if (out.length >= MAX_AGENTS || out.some((a) => a.id === r.id || a.key === r.key || a.name.toLowerCase() === name.toLowerCase())) continue
    out.push({ id: r.id, name, key: r.key, createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0 })
  }
  return out
}
