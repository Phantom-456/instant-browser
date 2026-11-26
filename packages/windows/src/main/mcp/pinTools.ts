import { str, type McpTool } from '../../shared/mcp/protocol'
import type { PinRecord } from '../../shared/pins/model'

/** What the pin tools can do. There is no delete here, on purpose: agents can never delete a pin. */
export interface PinToolDeps {
  pins(): PinRecord[]
  archivedPins(): PinRecord[]
  maxPins(): number
  /** Same as the toolbar's Collapse button. False when there is no such open window. */
  collapse(windowId: number): boolean
  rename(id: string, label: string): Promise<void>
  archive(id: string): Promise<void>
  unarchive(id: string): Promise<void>
  /** Waits a little. Tests give a fast one. */
  sleep?: (ms: number) => Promise<void>
}

const noPin = (): Error => new Error('No pin has that id. Use list_pins to see the pins.')
const idSchema = { type: 'object', properties: { id: { type: 'string', description: 'The pin id from list_pins.' } }, required: ['id'], additionalProperties: false } as const

/** The tools that set up pins. Archiving can be undone; nothing here deletes. */
export function pinTools(deps: PinToolDeps): McpTool[] {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  return [
    {
      name: 'pin_window',
      group: 'pins',
      changes: true,
      description: 'Turn an open small window into a pin, like pressing its Collapse button. Get the window id from list_windows. Fails when the person has reached their pin limit.',
      inputSchema: { type: 'object', properties: { windowId: { type: 'integer', description: 'The window id from list_windows.' } }, required: ['windowId'], additionalProperties: false },
      async run(args) {
        const windowId = args.windowId
        if (typeof windowId !== 'number' || !Number.isInteger(windowId)) throw new Error('"windowId" must be a whole number')
        if (deps.pins().length >= deps.maxPins()) throw new Error(`The person already has ${deps.maxPins()} pins, which is their limit. Archive a pin first or ask them to raise the limit.`)
        const before = new Set(deps.pins().map((p) => p.id))
        if (!deps.collapse(windowId)) throw new Error('No open window has that id, or its page cannot be pinned. Use list_windows to see the open windows.')
        // The pin is made a moment later, so look for the new one
        for (let i = 0; i < 10; i++) {
          const made = deps.pins().find((p) => !before.has(p.id))
          if (made) return { pinned: true, id: made.id }
          await sleep(100)
        }
        return { pinned: true }
      }
    },
    {
      name: 'rename_pin',
      group: 'pins',
      changes: true,
      description: 'Give a pin a name (up to 60 characters). An empty label clears the name, so the page title shows again.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The pin id from list_pins.' }, label: { type: 'string', description: 'The new name, 0 to 60 characters.' } }, required: ['id', 'label'], additionalProperties: false },
      async run(args) {
        const id = str(args, 'id', 100, true)
        const label = str(args, 'label', 60, false)
        if (![...deps.pins(), ...deps.archivedPins()].some((p) => p.id === id)) throw noPin()
        await deps.rename(id, label)
        return { renamed: true, id, label }
      }
    },
    {
      name: 'archive_pin',
      group: 'pins',
      changes: true,
      description: 'Move a pin to the Archive. This can be undone with unarchive_pin, and the person can put it back too. Agents can never delete pins.',
      inputSchema: idSchema,
      async run(args) {
        const id = str(args, 'id', 100, true)
        if (!deps.pins().some((p) => p.id === id)) throw noPin()
        await deps.archive(id)
        return { archived: true, id }
      }
    },
    {
      name: 'unarchive_pin',
      group: 'pins',
      changes: true,
      description: 'Put an archived pin back on the screen. Get the id from list_pins with archived pins included.',
      inputSchema: idSchema,
      async run(args) {
        const id = str(args, 'id', 100, true)
        if (!deps.archivedPins().some((p) => p.id === id)) throw new Error('No archived pin has that id. Use list_pins to see the pins.')
        await deps.unarchive(id)
        return { unarchived: true, id }
      }
    }
  ]
}
