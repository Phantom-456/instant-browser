import { str, type McpTool } from '../../shared/mcp/protocol'
import type { Settings } from '../../shared/settings'
import { capabilities, changeableKeys, checkNotWider, checkPatch, visibleSettings } from '../../shared/mcp/settingsPolicy'

export interface SettingsToolDeps {
  get(): Settings
  /** Save the change and run what a change needs (hotkey, warm window and so on). */
  update(patch: Partial<Settings>): void
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Read the settings that are not secret, and change the safe ones. */
export function settingsTools(deps: SettingsToolDeps): McpTool[] {
  return [
    {
      name: 'get_settings',
      group: 'read',
      changes: false,
      description: 'Read Talaria\'s settings. Passwords, keys and agent settings are never included. "changeable" lists the settings set_setting may change; the others are read only. "capabilities" says which groups of tools the person has switched on (read is always on); a group that is false stays refused until the person turns it on in Settings > Agents.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => ({ settings: visibleSettings(deps.get()), changeable: changeableKeys(), capabilities: capabilities(deps.get()) })
    },
    {
      name: 'set_setting',
      group: 'settings',
      changes: true,
      description: 'Change one look or behaviour setting, such as pinSize, defaultZoom or windowSize. Only the keys in get_settings "changeable" work. Settings that decide what is read from the person\'s other browsers (showHistory, historyOff, otherBookmarks, bookmarksOff) can only be changed to read less. The person sees every change and can undo it.',
      inputSchema: { type: 'object', properties: { key: { type: 'string', enum: changeableKeys() }, value: { description: 'The new value. A number, true or false, text or a list, as get_settings shows for that key.' } }, required: ['key', 'value'], additionalProperties: false },
      run(args) {
        const key = str(args, 'key', 60, true)
        const patch = checkPatch(key, args.value)
        checkNotWider(patch, deps.get())
        const before = (deps.get() as unknown as Record<string, unknown>)[key]
        deps.update(patch)
        return { key, before, after: (deps.get() as unknown as Record<string, unknown>)[key] }
      },
      undo(result) {
        const r = result as { key?: unknown; before?: unknown; after?: unknown }
        if (typeof r?.key !== 'string' || same(r.before, r.after)) return undefined
        return { key: r.key, value: r.before }
      }
    }
  ]
}
