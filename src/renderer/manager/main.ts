import type { ManagerAction, ManagerMarkFolder, ManagerRow, ManagerView } from '../../shared/ipc'
import { siteKind, SITE_KIND_TEXT } from '../../shared/siteKind'

interface InstantManager {
  get(): Promise<ManagerView>
  action(action: ManagerAction): Promise<ManagerView>
  onChanged(callback: () => void): void
}
const api = (window as unknown as { instantManager: InstantManager }).instantManager

let view: ManagerView = { agentFolders: [], pins: [], archive: [], windows: [], bookmarks: [], history: [], devices: [], browserMarks: { count: 0, tree: { name: '', folders: [], marks: [] } }, tabs: [], platform: '', maxPins: 12 }
const expanded = new Set<string>()
let renaming: string | null = null
let editingBookmark: string | null = null
let historyShown = 25

const main = document.getElementById('main') as HTMLElement
const summary = document.getElementById('summary') as HTMLElement
const search = document.getElementById('search') as HTMLInputElement
const tabsBar = document.getElementById('tabs') as HTMLElement
const toastBox = document.getElementById('toast') as HTMLElement
const toastText = document.getElementById('toast-text') as HTMLElement

type SectionId = 'pins' | 'windows' | 'bookmarks' | 'history' | 'browsers' | 'computers' | 'archive' | 'agents'
/** Which section the tab bar shows: all of them, or one. */
let tab: 'all' | SectionId = 'all'
/** Words typed in the search box: a row shows only if every word is somewhere in it. */
const words = () => search.value.toLowerCase().split(/\s+/).filter(Boolean)
const matches = (...parts: Array<string | undefined>) => { const w = words(); if (w.length === 0) return true; const hay = parts.join(' ').toLowerCase(); return w.every((x) => hay.includes(x)) }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function node<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  Object.assign(element, props)
  element.append(...children)
  return element
}
const run = async (action: ManagerAction) => { view = await api.action(action); render() }
/** The buttons of a row: the main one is always in view; the others slide in when the row is hovered or has the keyboard focus. */
const actionsOf = (main: HTMLElement[], more: HTMLElement[]) => node('div', { className: 'actions' }, ...(more.length ? [node('div', { className: 'more' }, ...more)] : []), ...main)
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
      ...(r.following ? [node('span', { className: 'chip' }, 'Follows you')] : []),
      ...(r.syncOff ? [node('span', { className: 'chip local' }, 'Only on this computer')] : [])))
  const details = btn('Details', () => { if (expanded.has(r.id)) expanded.delete(r.id); else expanded.add(r.id); render() })
  const actions = !r.archived
    ? actionsOf(
        [btn('Open', () => void run({ type: 'open', id: r.id }), 'go', 'Open the window again, where it was')],
        [
          btn('Rename', () => { renaming = r.id; render() }),
          ...(released ? [] : [btn('Offload', () => void run({ type: 'offload', id: r.id }), '', 'Release the page from memory. The pin stays.')]),
          ...(view.platform === 'darwin' ? [btn('Follow', () => void run({ type: 'follow', id: r.id }), r.following ? 'on' : '', 'Show this pin on every desktop')] : []),
          btn(r.syncOff ? 'Sync it' : 'Keep here', () => void run({ type: 'pin-local', id: r.id, off: !r.syncOff }), r.syncOff ? 'on' : '', r.syncOff ? 'Send this pin to Google Drive again' : 'Keep this pin on this computer only. It is never sent to Google Drive.'),
          details,
          btn('Remove', () => void run({ type: 'archive', id: r.id }), 'danger', 'Takes the pin off the screen. It is kept in the archive below.')
        ]
      )
    : actionsOf(
        [btn('Put back', () => void run({ type: 'put-back', id: r.id }), 'go', 'Show this pin on the screen again (released)')],
        [details, btn('Delete for good', () => void run({ type: 'delete', id: r.id }), 'danger', 'Deletes the pin and its saved picture. Cannot be undone.')]
      )
  const row = node('div', { className: 'row', id: `row-${r.id}`, tabIndex: -1 }, swatch, text, actions)
  if (expanded.has(r.id)) row.append(detailRows(r))
  return row
}

/** Folders of the browsers' bookmarks that are open. A folder draws its content only while it is open. */
const openFolders = new Set<string>()
const markRow = (m: { url: string; title: string; sources: string[] }) =>
  node('div', { className: 'row' }, node('span', { className: 'swatch star' }),
    node('div', { className: 'text' }, node('div', { className: 'name' }, m.title || m.url), node('div', { className: 'url' }, m.url),
      node('div', { className: 'chips' }, ...m.sources.map((s) => node('span', { className: 'chip' }, s)))),
    actionsOf([btn('Open', () => void run({ type: 'open-url', url: m.url }), 'go')], []))

function folderView(folder: ManagerMarkFolder, path: string): HTMLElement[] {
  const out: HTMLElement[] = []
  const count = (x: ManagerMarkFolder): number => x.marks.length + x.folders.reduce((n, y) => n + count(y), 0)
  for (const f of folder.folders) {
    const key = `${path}/${f.name}`
    const open = openFolders.has(key)
    // A real button: it works with the keyboard and tells a screen reader if it is open.
    const head = node('button', { type: 'button', className: `row folder${open ? ' open' : ''}`, title: open ? 'Close this folder' : 'Open this folder' },
      node('span', { className: 'swatch folder' }),
      node('div', { className: 'text' }, node('div', { className: 'name' }, f.name), node('div', { className: 'url' }, plural(count(f), 'bookmark'))),
      node('span', { className: 'caret', ariaHidden: 'true' }, '▸'))
    head.setAttribute('aria-expanded', String(open))
    head.onclick = () => { if (open) openFolders.delete(key); else openFolders.add(key); render() }
    out.push(head)
    if (open) out.push(node('div', { className: 'indent' }, ...folderView(f, key)))
  }
  for (const m of folder.marks) out.push(markRow(m))
  return out
}

/** Agent folders that are open. */
const openAgentFolders = new Set<string>()

function agentFolderView(f: ManagerView['agentFolders'][number], items: ManagerView['agentFolders'][number]['items']): HTMLElement[] {
  const open = openAgentFolders.has(f.id)
  const head = node('button', { type: 'button', className: `row folder${open ? ' open' : ''}`, title: open ? 'Close this folder' : 'Open this folder' },
    node('span', { className: 'swatch folder' }),
    node('div', { className: 'text' }, node('div', { className: 'name' }, f.name),
      node('div', { className: 'url' }, `By ${f.owner}. ${plural(f.items.length, 'page')}`),
      node('div', { className: 'chips' }, node('span', { className: f.allowDelete ? 'chip live' : 'chip' }, f.allowDelete ? 'Deletion by the agent allowed' : 'Deletion by the agent not allowed'))),
    node('span', { className: 'caret', ariaHidden: 'true' }, '▸'))
  head.setAttribute('aria-expanded', String(open))
  head.onclick = () => { if (open) openAgentFolders.delete(f.id); else openAgentFolders.add(f.id); render() }
  const out: HTMLElement[] = [head]
  if (!open) return out
  const inside: HTMLElement[] = [node('div', { className: 'row' }, node('span', { className: 'swatch' }),
    node('div', { className: 'text' }, node('div', { className: 'name' }, 'This folder'), node('div', { className: 'url' }, f.allowDelete ? 'The agent can remove pages and delete the folder.' : 'The agent can add pages but not remove them.')),
    actionsOf([btn(f.allowDelete ? 'Lock' : 'Allow deletion', () => void run({ type: 'agent-permission', folderId: f.id, allowDelete: !f.allowDelete }), '', f.allowDelete ? 'Stop the agent from removing pages or deleting this folder' : 'Let the agent remove pages and delete this folder')],
      [btn('Remove folder', () => softRemove(`af:${f.id}`, `Folder "${f.name}" removed.`, { type: 'agent-remove-folder', folderId: f.id }), 'danger', 'Removes the folder and its pages. You can undo it for a few seconds.')]))]
  if (items.length === 0) inside.push(node('div', { className: 'empty' }, 'No pages in this folder.'))
  for (const b of items) {
    inside.push(node('div', { className: 'row' }, node('span', { className: 'swatch star' }),
      node('div', { className: 'text' }, node('div', { className: 'name' }, b.title || b.url), node('div', { className: 'url' }, b.url)),
      actionsOf([btn('Open', () => void run({ type: 'open-url', url: b.url }), 'go')], [
        btn('Move to my bookmarks', () => void run({ type: 'agent-move-item', folderId: f.id, itemId: b.id }), '', 'Adds this page to your bookmarks and takes it out of this folder'),
        btn('Remove', () => softRemove(`afi:${f.id}:${b.id}`, `Page "${b.title || b.url}" removed.`, { type: 'agent-remove-item', folderId: f.id, itemId: b.id }), 'danger', 'Removes this page from the folder. You can undo it for a few seconds.')
      ])))
  }
  out.push(node('div', { className: 'indent' }, ...inside))
  return out
}

/** Every bookmark of the browsers' tree, once each (a page in two folders is one result). */
function flatMarks(folder: ManagerMarkFolder, seen = new Map<string, ManagerMarkFolder['marks'][number]>()): ManagerMarkFolder['marks'] {
  for (const m of folder.marks) if (!seen.has(m.url)) seen.set(m.url, m)
  for (const f of folder.folders) flatMarks(f, seen)
  return [...seen.values()]
}

// ---- Undo: a bookmark or a history entry is taken off the list at once and removed for real after a few seconds ----
const hidden = new Set<string>()
let pending: { key: string; timer: number; commit: () => Promise<void> } | null = null
function flushPending(): void {
  if (!pending) return
  const p = pending
  pending = null
  window.clearTimeout(p.timer)
  void p.commit()
  toastBox.classList.remove('show')
}
function softRemove(key: string, text: string, action: ManagerAction): void {
  flushPending() // an earlier one is made final first
  hidden.add(key)
  const commit = async () => { await run(action); hidden.delete(key) }
  pending = { key, timer: window.setTimeout(flushPending, 6000), commit }
  toastText.textContent = text
  toastBox.hidden = false
  void toastBox.offsetWidth // let the entrance start from the hidden state
  toastBox.classList.add('show')
  render()
}
document.getElementById('toast-undo')!.addEventListener('click', () => {
  if (!pending) return
  window.clearTimeout(pending.timer)
  hidden.delete(pending.key)
  pending = null
  toastBox.classList.remove('show')
  render()
})
window.addEventListener('pagehide', flushPending)

interface Section { id: SectionId; title: string; count: number; label: string; body: () => HTMLElement[] }

function sections(): Section[] {
  const pins = view.pins.filter((r) => matches(r.label, r.url))
  const archive = view.archive.filter((r) => matches(r.label, r.url))
  const windows = view.windows.filter((w) => matches(w.title, w.url))
  const bookmarks = view.bookmarks.filter((b) => !hidden.has(`bm:${b.id}`) && matches(b.title, b.url))
  const history = view.history.filter((h) => !hidden.has(`h:${h.url}`) && matches(h.title, h.url, ...h.sources))
  const marks = words().length ? flatMarks(view.browserMarks.tree).filter((m) => matches(m.title, m.url, ...m.sources)) : []
  const marksCount = words().length ? marks.length : view.browserMarks.count
  const tabs = view.tabs.filter((t) => matches(t.title, t.url, t.browser))
  const devices = view.devices.map((d) => ({ ...d, tabs: d.tabs.filter((t) => matches(t.title, t.url, d.name)) })).filter((d) => words().length === 0 || d.tabs.length > 0)
  const searching = words().length > 0
  const agentFolders = view.agentFolders.filter((f) => !hidden.has(`af:${f.id}`)).map((f) => {
    const kept = f.items.filter((b) => !hidden.has(`afi:${f.id}:${b.id}`))
    const own = matches(f.name, f.owner)
    return { f: { ...f, items: kept }, shown: own ? kept : kept.filter((b) => matches(b.title, b.url)), own }
  }).filter((x) => x.own || x.shown.length > 0)

  const list: Section[] = []
  list.push({ id: 'pins', title: `Pins (${pins.length})`, count: pins.length, label: 'Pins', body: () => [
    ...(pins.length === 0 ? [node('div', { className: 'empty' }, searching ? 'No pin matches.' : 'No pins. Press the pin button in a window to collapse it into a pin.')] : []),
    ...pins.map(pinRow)
  ] })
  list.push({ id: 'windows', title: `Open windows (${windows.length})`, count: windows.length, label: 'Windows', body: () => [
    ...(windows.length === 0 ? [node('div', { className: 'empty' }, searching ? 'No window matches.' : 'No open windows. An open window is not a pin: Close ends it, and the page is gone.')] : []),
    ...windows.map((w) => node('div', { className: 'row' }, node('span', { className: 'swatch' }),
      node('div', { className: 'text' }, node('div', { className: 'name' }, w.title || w.url), node('div', { className: 'url' }, w.url)),
      actionsOf([btn('Show', () => void run({ type: 'show-window', windowId: w.id }), 'go')], [btn('Close', () => void run({ type: 'close-window', windowId: w.id }), 'danger', 'Closes the window. Its page is gone.')])))
  ] })
  list.push({ id: 'bookmarks', title: `Bookmarks (${bookmarks.length})`, count: bookmarks.length, label: 'Bookmarks', body: () => {
    const out: HTMLElement[] = []
    if (bookmarks.length === 0) out.push(node('div', { className: 'empty' }, searching ? 'No bookmark matches.' : 'No bookmarks. Press the star in a window to bookmark its page.'))
    for (const b of bookmarks) {
      if (editingBookmark === b.id) {
        const title = node('input', { className: 'rename', type: 'text', value: b.title, maxLength: 300, placeholder: 'Name' })
        const url = node('input', { className: 'rename', type: 'text', value: b.url, maxLength: 2000, placeholder: 'Address' })
        const save = () => { editingBookmark = null; void run({ type: 'bookmark-edit', id: b.id, title: title.value, url: url.value }) }
        for (const input of [title, url]) input.onkeydown = (e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') { editingBookmark = null; render() } }
        out.push(node('div', { className: 'row' }, node('span', { className: 'swatch star' }), node('div', { className: 'text edit' }, title, url),
          node('div', { className: 'actions' }, btn('Save', save, 'primary'), btn('Cancel', () => { editingBookmark = null; render() }))))
        queueMicrotask(() => title.focus())
        continue
      }
      out.push(node('div', { className: 'row' }, node('span', { className: 'swatch star' }),
        node('div', { className: 'text' }, node('div', { className: 'name' }, b.title || b.url), node('div', { className: 'url' }, b.url), ...(b.syncOff ? [node('div', { className: 'chips' }, node('span', { className: 'chip local' }, 'Only on this computer'))] : [])),
        actionsOf([btn('Open', () => void run({ type: 'open-url', url: b.url }), 'go')], [
          btn('Edit', () => { editingBookmark = b.id; render() }, '', 'Change the name or the address'),
          btn(b.syncOff ? 'Sync it' : 'Keep here', () => void run({ type: 'bookmark-local', id: b.id, off: !b.syncOff }), b.syncOff ? 'on' : '', b.syncOff ? 'Send this bookmark to Google Drive again' : 'Keep this bookmark on this computer only. It is never sent to Google Drive.'),
          btn('Remove', () => softRemove(`bm:${b.id}`, `Bookmark "${b.title || b.url}" removed.`, { type: 'remove-bookmark', id: b.id }), 'danger', 'Removes the bookmark here and on your other computers. You can undo it for a few seconds.')
        ])))
    }
    return out
  } })
  list.push({ id: 'agents', title: `Agent folders (${agentFolders.length})`, count: agentFolders.length, label: 'Agent folders', body: () => [
    node('div', { className: 'note' }, 'Folders that agents made through the built-in MCP server. Your own bookmarks are never changed by an agent. You can always remove a page or a folder.'),
    ...(agentFolders.length === 0 ? [node('div', { className: 'empty' }, searching ? 'No agent folder matches.' : 'No agent folders yet.')] : []),
    ...agentFolders.flatMap((x) => agentFolderView(x.f, x.shown))
  ] })
  list.push({ id: 'history', title: `History (${history.length})`, count: history.length, label: 'History', body: () => {
    const out: HTMLElement[] = [node('div', { className: 'note' }, 'Pages from Talaria and your other browsers. You can delete what was opened in Talaria. The other browsers keep their own history, shown here to read only.')]
    if (history.length === 0) out.push(node('div', { className: 'empty' }, searching ? 'No page matches.' : 'No history yet.'))
    for (const h of history.slice(0, historyShown)) {
      const kind = siteKind(h.url)
      out.push(node('div', { className: 'row' }, node('span', { className: `swatch kind-${kind}`, title: SITE_KIND_TEXT[kind] }),
        node('div', { className: 'text' }, node('div', { className: 'name' }, h.title || h.url), node('div', { className: 'url' }, h.url),
          node('div', { className: 'chips' }, node('span', { className: `chip kind-${kind}` }, SITE_KIND_TEXT[kind]), ...h.sources.map((s) => node('span', { className: 'chip' }, s)), node('span', { className: 'chip' }, when(h.lastVisit)))),
        actionsOf([btn('Open', () => void run({ type: 'open-url', url: h.url }), 'go')],
          h.own ? [btn('Delete', () => softRemove(`h:${h.url}`, 'Page removed from Talaria history.', { type: 'history-delete', url: h.url }), 'danger', 'Forgets this page in Talaria. Other browsers are not changed. You can undo it for a few seconds.')] : [])))
    }
    if (history.length > historyShown) out.push(node('div', { className: 'more-row' }, btn(`Show more (${history.length - historyShown})`, () => { historyShown += 50; render() })))
    return out
  } })
  list.push({ id: 'browsers', title: `Bookmarks from your browsers (${marksCount})`, count: marksCount + tabs.length, label: 'Browsers', body: () => {
    const out: HTMLElement[] = [node('div', { className: 'note' }, 'Read from the bookmark files of the browsers on this computer. Change them in the browser. Turn this on or off in Settings, under Your browsers.')]
    if (marksCount === 0) out.push(node('div', { className: 'empty' }, searching ? 'No browser bookmark matches.' : 'No bookmarks found (or this is turned off in Settings).'))
    else if (searching) out.push(...marks.slice(0, 80).map(markRow))
    else out.push(...folderView(view.browserMarks.tree, ''))
    if (tabs.length > 0) {
      out.push(node('h2', {}, `Open tabs in your browsers (${tabs.length})`))
      out.push(node('div', { className: 'note' }, 'Tabs open right now. "First seen" is when Talaria first noticed the tab: browsers do not say when a tab was made.'))
      for (const b of [...new Set(tabs.map((t) => t.browser))]) {
        out.push(node('div', { className: 'device' }, node('div', { className: 'name' }, b)))
        for (const t of tabs.filter((x) => x.browser === b)) {
          out.push(node('div', { className: 'row' }, node('span', { className: 'swatch' }),
            node('div', { className: 'text' }, node('div', { className: 'name' }, t.title || t.url), node('div', { className: 'url' }, t.url),
              node('div', { className: 'chips' }, node('span', { className: 'chip' }, `First seen ${when(t.firstSeen)}`))),
            actionsOf([btn('Open here', () => void run({ type: 'open-url', url: t.url }), 'go', 'Opens this page in a Talaria window.')], [])))
        }
      }
    }
    return out
  } })
  if (devices.length > 0) {
    list.push({ id: 'computers', title: `Open on your other computers (${devices.length})`, count: devices.length, label: 'Other computers', body: () => devices.flatMap((d) => [
      node('div', { className: 'device' }, node('div', { className: 'name' }, d.name), node('div', { className: 'url' }, `Updated ${when(d.updatedAt)}. ${d.tabs.length === 0 ? 'Nothing open.' : ''}`)),
      ...d.tabs.map((t) => node('div', { className: 'row' }, node('span', { className: t.kind === 'pin' ? 'swatch released' : 'swatch' }),
        node('div', { className: 'text' }, node('div', { className: 'name' }, t.title || t.url), node('div', { className: 'url' }, `${t.kind === 'pin' ? 'Pin' : 'Window'}. ${t.url}`)),
        actionsOf([btn('Open here', () => void run({ type: 'open-url', url: t.url }), 'go', 'Opens this page in a window on this computer.')], [])))
    ]) })
  }
  list.push({ id: 'archive', title: `Archive (${archive.length})`, count: archive.length, label: 'Archive', body: () => [
    ...(archive.length === 0 ? [node('div', { className: 'empty' }, searching ? 'No archived pin matches.' : 'Nothing here. Pins you remove wait here until you put them back or delete them for good.')] : []),
    ...archive.map(pinRow)
  ] })
  return list
}

/** The button that has the focus is found again after the list is drawn again, so the keyboard keeps its place. */
function focusMark(): string | null {
  const el = document.activeElement as HTMLElement | null
  const row = el?.closest?.('.row[id]')
  return el && row && el.tagName === 'BUTTON' ? `${row.id}\u0000${el.textContent ?? ''}` : null
}
function focusBack(mark: string | null): void {
  if (!mark) return
  const [id, label] = mark.split('\u0000')
  const row = document.getElementById(id as string)
  const target = row ? [...row.querySelectorAll('button')].find((b) => b.textContent === label) : undefined
  if (target) target.focus({ preventScroll: true })
}

let lastTab: 'all' | SectionId | null = null
function render(): void {
  const mark = focusMark()
  const all = sections()
  const live = view.pins.filter((p) => p.state === 'resident').length
  summary.textContent = `${view.pins.length} of ${view.maxPins} pins, ${live} with a live page (about 20 MB each)`
  if (tab !== 'all' && !all.some((s) => s.id === tab)) tab = 'all' // that section is gone (for example the other computers list)

  tabsBar.replaceChildren(...[{ id: 'all' as const, label: 'All', count: -1 }, ...all.map((s) => ({ id: s.id, label: s.label, count: s.count }))].map((t) => {
    const b = node('button', { type: 'button', className: `tab${tab === t.id ? ' active' : ''}` }, t.label, ...(t.count >= 0 ? [node('span', { className: 'n' }, String(t.count))] : []))
    b.setAttribute('aria-pressed', String(tab === t.id))
    b.onclick = () => { tab = t.id; render() }
    return b
  }))

  main.replaceChildren(...all.filter((s) => tab === 'all' || s.id === tab).flatMap((s) => [node('h2', {}, s.title), ...s.body()]),
    node('div', { className: 'note' }, view.platform === 'darwin'
      ? 'Desktops: macOS does not tell apps the names or numbers of your desktops (Spaces), so pins are listed in one place. A pin you cannot see because its desktop is gone is still here: use Open.'
      : 'Desktops: this system does not share desktop names with apps, so pins are listed in one place.'))
  // A change of tab fades the new list in. A change inside the same tab does not play it again.
  main.classList.toggle('switch', lastTab !== tab)
  lastTab = tab
  focusBack(mark)
}

search.addEventListener('input', () => { historyShown = 25; render() })
/** The button that stands for a row: the folder itself, or the main button of the row. */
const rowButton = (row: Element): HTMLElement | null => (row.matches('button.row') ? (row as HTMLElement) : row.querySelector<HTMLElement>('.actions > button'))

/** Up and Down walk through the rows. Right opens a bookmark folder, Left closes it. Enter presses the focused button. */
function walk(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  const active = document.activeElement as HTMLElement | null
  if (active instanceof HTMLInputElement && active !== search) return false // editing a name: the keys belong to the field
  const rows = [...main.querySelectorAll<HTMLElement>('.row')].filter((r) => rowButton(r))
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (rows.length === 0) return false
    const at = rows.findIndex((r) => r === active || r.contains(active))
    const next = e.key === 'ArrowDown' ? (at < 0 ? 0 : Math.min(at + 1, rows.length - 1)) : at <= 0 ? -1 : at - 1
    if (next < 0) { search.focus(); search.select() } else rowButton(rows[next] as HTMLElement)?.focus()
    return true
  }
  const folder = active?.closest?.('button.row.folder') as HTMLElement | null
  if (folder && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const open = folder.getAttribute('aria-expanded') === 'true'
    if ((e.key === 'ArrowRight') !== open) folder.click()
    return true
  }
  return false
}

window.addEventListener('keydown', (e) => {
  if (walk(e)) { e.preventDefault(); return }
  const typing = document.activeElement === search || document.activeElement instanceof HTMLInputElement
  if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f')) { e.preventDefault(); search.focus(); search.select() }
  else if (e.key === 'Escape' && document.activeElement === search) { if (search.value) { search.value = ''; render() } else search.blur() }
})

api.onChanged(() => { if (renaming === null && editingBookmark === null) void api.get().then((v) => { view = v; render() }) })
void api.get().then((v) => { view = v; render() })
