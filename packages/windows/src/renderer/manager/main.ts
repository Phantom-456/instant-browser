import type { ManagerAction, ManagerRow, ManagerView } from '../../shared/ipc'
import '../shared/platform'

interface InstantManager {
  get(): Promise<ManagerView>
  action(action: ManagerAction): Promise<ManagerView>
  onChanged(callback: () => void): void
}
const api = (window as unknown as { instantManager: InstantManager }).instantManager

let view: ManagerView = { agentFolders: [], pins: [], archive: [], windows: [], platform: '', maxPins: 12 }
const expanded = new Set<string>()
const openFolders = new Set<string>() // agent folders that show their pages
let renaming: string | null = null

const main = document.getElementById('main') as HTMLElement
const summary = document.getElementById('summary') as HTMLElement

function node<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  Object.assign(element, props)
  element.append(...children)
  return element
}
const run = async (action: ManagerAction) => { view = await api.action(action); render() }
const btn = (text: string, onClick: () => void, cls = '', title = '') => node('button', { type: 'button', textContent: text, className: cls, title, onclick: onClick })
const when = (t: number | null) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never')

function detailRows(r: ManagerRow): HTMLElement {
  const list = node('dl', { className: 'details' })
  const add = (k: string, v: string) => list.append(node('dt', {}, k), node('dd', {}, v))
  add('Address', r.url)
  add('Page', r.state === 'resident' ? 'In memory behind the pin' : 'Released (loads again when opened)')
  add('Saved picture', r.snapshotAt ? `${when(r.snapshotAt)} (${Math.max(1, Math.round(r.pictureBytes / 1024))} KB)` : 'none')
  add('Scroll position', r.scrollY === null ? 'not saved' : `${r.scrollY} px from the top`)
  add('Follows you to every desktop', r.following ? 'yes' : 'no')
  add('Created', when(r.createdAt))
  add('Last used', when(r.lastUsedAt))
  if (r.archivedAt) add('Removed', when(r.archivedAt))
  return list
}

function pinRow(r: ManagerRow): HTMLElement {
  const released = r.state === 'offloaded'
  const swatch = node('span', { className: released ? 'swatch released' : 'swatch' })
  swatch.style.setProperty('--g', r.gradient)
  if (!released) swatch.style.background = r.gradient
  const name = renaming === r.id
    ? (() => {
        const input = node('input', { className: 'rename', type: 'text', value: r.customLabel || r.label, maxLength: 60 })
        const done = (save: boolean) => { const text = input.value; renaming = null; if (save) void run({ type: 'rename', id: r.id, text }); else render() }
        input.onkeydown = (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false) }
        input.onblur = () => done(true)
        queueMicrotask(() => { input.focus(); input.select() })
        return input
      })()
    : node('div', { className: 'name', title: 'Double-click to rename', ondblclick: () => { renaming = r.id; render() } }, r.label)
  const text = node('div', { className: 'text' }, name, node('div', { className: 'url' }, r.url),
    node('div', { className: 'chips' },
      node('span', { className: released ? 'chip' : 'chip live' }, released ? 'Page released (border only)' : 'Page in memory'),
      ...(r.following ? [node('span', { className: 'chip' }, 'Follows you')] : [])))
  const actions = node('div', { className: 'actions' })
  if (!r.archived) {
    actions.append(
      btn('Open', () => void run({ type: 'open', id: r.id }), 'primary', 'Open the window again, where it was'),
      btn('Rename', () => { renaming = r.id; render() }),
      ...(released ? [] : [btn('Offload', () => void run({ type: 'offload', id: r.id }), '', 'Release the page from memory. The pin stays.')]),
      ...(view.platform === 'darwin' ? [btn('Follow', () => void run({ type: 'follow', id: r.id }), r.following ? 'on' : '', 'Show this pin on every desktop')] : []),
      btn('Details', () => { if (expanded.has(r.id)) expanded.delete(r.id); else expanded.add(r.id); render() }),
      btn('Remove', () => void run({ type: 'archive', id: r.id }), 'danger', 'Takes the pin off the screen. It is kept in the archive below.')
    )
  } else {
    actions.append(
      btn('Put back', () => void run({ type: 'put-back', id: r.id }), 'primary', 'Show this pin on the screen again (released)'),
      btn('Details', () => { if (expanded.has(r.id)) expanded.delete(r.id); else expanded.add(r.id); render() }),
      btn('Delete for good', () => void run({ type: 'delete', id: r.id }), 'danger', 'Deletes the pin and its saved picture. Cannot be undone.')
    )
  }
  const row = node('div', { className: 'row', id: `row-${r.id}` }, swatch, text, actions)
  if (expanded.has(r.id)) row.append(detailRows(r))
  return row
}

function agentFolderRow(f: ManagerView['agentFolders'][number]): HTMLElement {
  const open = openFolders.has(f.id)
  const text = node('div', { className: 'text' }, node('div', { className: 'name' }, f.name),
    node('div', { className: 'url' }, `By ${f.owner} · ${f.items.length} pages`),
    node('div', { className: 'chips' }, node('span', { className: f.allowDelete ? 'chip live' : 'chip' }, f.allowDelete ? 'The agent may delete' : 'The agent may not delete')))
  const actions = node('div', { className: 'actions' },
    btn(open ? 'Hide pages' : 'Show pages', () => { if (open) openFolders.delete(f.id); else openFolders.add(f.id); render() }),
    btn(f.allowDelete ? 'Lock' : 'Allow deletion', () => void run({ type: 'agent-permission', folderId: f.id, allowDelete: !f.allowDelete }), '', 'Choose whether the agent that made this folder may remove pages from it or delete it'),
    btn('Remove folder', () => void run({ type: 'agent-remove-folder', folderId: f.id }), 'danger', 'Deletes this folder and its pages. Your own pins are not touched.'))
  const row = node('div', { className: 'row', id: `agent-folder-${f.id}` }, node('span', { className: 'swatch' }), text, actions)
  if (open) {
    const list = node('div', { className: 'agent-items' })
    if (f.items.length === 0) list.append(node('div', { className: 'empty' }, 'No pages yet.'))
    for (const item of f.items) {
      list.append(node('div', { className: 'row' },
        node('div', { className: 'text' }, node('div', { className: 'name' }, item.title || item.url), node('div', { className: 'url' }, item.url)),
        node('div', { className: 'actions' },
          btn('Open', () => void run({ type: 'open-url', url: item.url })),
          btn('Remove', () => void run({ type: 'agent-remove-item', folderId: f.id, itemId: item.id }), 'danger'))))
    }
    row.append(list)
  }
  return row
}

function render(): void {
  summary.textContent = `${view.pins.length} of ${view.maxPins} pins. A pin whose page is alive has a small window of its own (about 20 MB). A pin whose page is released uses almost no memory.`
  main.replaceChildren()

  main.append(node('h2', {}, `Pins (${view.pins.length})`))
  if (view.pins.length === 0) main.append(node('div', { className: 'empty' }, 'No pins. Press the pin button in a window to collapse it into a pin.'))
  for (const r of view.pins) main.append(pinRow(r))

  main.append(node('h2', {}, `Open windows (${view.windows.length})`))
  if (view.windows.length === 0) main.append(node('div', { className: 'empty' }, 'No open windows. An open window is not a pin: Close ends it, and the page is gone.'))
  for (const w of view.windows) {
    main.append(node('div', { className: 'row' }, node('span', { className: 'swatch' }),
      node('div', { className: 'text' }, node('div', { className: 'name' }, w.title || w.url), node('div', { className: 'url' }, w.url)),
      node('div', { className: 'actions' }, btn('Show', () => void run({ type: 'show-window', windowId: w.id })), btn('Close', () => void run({ type: 'close-window', windowId: w.id }), 'danger', 'Closes the window. Its page is gone.'))))
  }

  main.append(node('h2', {}, `Archive (${view.archive.length})`))
  if (view.archive.length === 0) main.append(node('div', { className: 'empty' }, 'Nothing here. Pins you remove wait here until you put them back or delete them for good.'))
  for (const r of view.archive) main.append(pinRow(r))

  main.append(node('h2', {}, `Agent folders (${view.agentFolders.length})`))
  if (view.agentFolders.length === 0) main.append(node('div', { className: 'empty' }, 'No agent folders. Agents that you allow in Settings > Agents can make folders of their own to save pages in.'))
  for (const f of view.agentFolders) main.append(agentFolderRow(f))

  main.append(node('div', { className: 'note' },
    view.platform === 'darwin'
      ? 'Desktops: macOS does not tell apps the names or numbers of your desktops (Spaces), so pins are listed in one place. A pin you cannot see because its desktop is gone is still here: use Open.'
      : 'Desktops: Windows does not tell apps the names of your virtual desktops, so pins from every desktop are listed here together.'))
}

api.onChanged(() => { if (renaming === null) void api.get().then((v) => { view = v; render() }) })
void api.get().then((v) => { view = v; render() })
