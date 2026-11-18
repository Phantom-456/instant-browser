import type { ManagerAction, ManagerMarkFolder, ManagerRow, ManagerView } from '../../shared/ipc'
import { siteKind, SITE_KIND_TEXT } from '../../shared/siteKind'

interface InstantManager {
  get(): Promise<ManagerView>
  action(action: ManagerAction): Promise<ManagerView>
  onChanged(callback: () => void): void
}
const api = (window as unknown as { instantManager: InstantManager }).instantManager

let view: ManagerView = { pins: [], archive: [], windows: [], bookmarks: [], history: [], devices: [], browserMarks: { count: 0, tree: { name: '', folders: [], marks: [] } }, tabs: [], platform: '', maxPins: 12 }
const expanded = new Set<string>()
let renaming: string | null = null
let editingBookmark: string | null = null
let historyShown = 25

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
      ...(r.following ? [node('span', { className: 'chip' }, 'Follows you')] : []),
      ...(r.syncOff ? [node('span', { className: 'chip local' }, 'Only on this computer')] : [])))
  const actions = node('div', { className: 'actions' })
  if (!r.archived) {
    actions.append(
      btn('Open', () => void run({ type: 'open', id: r.id }), 'primary', 'Open the window again, where it was'),
      btn('Rename', () => { renaming = r.id; render() }),
      ...(released ? [] : [btn('Offload', () => void run({ type: 'offload', id: r.id }), '', 'Release the page from memory. The pin stays.')]),
      ...(view.platform === 'darwin' ? [btn('Follow', () => void run({ type: 'follow', id: r.id }), r.following ? 'on' : '', 'Show this pin on every desktop')] : []),
      btn(r.syncOff ? 'Sync it' : 'Keep here', () => void run({ type: 'pin-local', id: r.id, off: !r.syncOff }), r.syncOff ? 'on' : '', r.syncOff ? 'Send this pin to Google Drive again' : 'Keep this pin on this computer only. It is never sent to Google Drive.'),
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

/** Folders of the browsers' bookmarks that are open. A folder draws its content only while it is open. */
const openFolders = new Set<string>()
function folderView(folder: ManagerMarkFolder, path: string): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const f of folder.folders) {
    const key = `${path}/${f.name}`
    const count = (x: ManagerMarkFolder): number => x.marks.length + x.folders.reduce((n, y) => n + count(y), 0)
    const open = openFolders.has(key)
    const head = node('div', { className: 'row folder', title: open ? 'Close this folder' : 'Open this folder' },
      node('span', { className: 'swatch folder' }),
      node('div', { className: 'text' }, node('div', { className: 'name' }, `${open ? '\u25BE' : '\u25B8'} ${f.name}`), node('div', { className: 'url' }, `${count(f)} bookmarks`)))
    head.onclick = () => { if (open) openFolders.delete(key); else openFolders.add(key); render() }
    out.push(head)
    if (open) {
      const inner = node('div', { className: 'indent' }, ...folderView(f, key))
      out.push(inner)
    }
  }
  for (const m of folder.marks) {
    out.push(node('div', { className: 'row' }, node('span', { className: 'swatch star' }),
      node('div', { className: 'text' }, node('div', { className: 'name' }, m.title || m.url), node('div', { className: 'url' }, m.url),
        node('div', { className: 'chips' }, ...m.sources.map((s) => node('span', { className: 'chip' }, s)))),
      node('div', { className: 'actions' }, btn('Open', () => void run({ type: 'open-url', url: m.url }), 'primary'))))
  }
  return out
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

  main.append(node('h2', {}, `Bookmarks (${view.bookmarks.length})`))
  if (view.bookmarks.length === 0) main.append(node('div', { className: 'empty' }, 'No bookmarks. Press the star in a window to bookmark its page.'))
  for (const b of view.bookmarks) {
    if (editingBookmark === b.id) {
      const title = node('input', { className: 'rename', type: 'text', value: b.title, maxLength: 300, placeholder: 'Name' })
      const url = node('input', { className: 'rename', type: 'text', value: b.url, maxLength: 2000, placeholder: 'Address' })
      const save = () => { editingBookmark = null; void run({ type: 'bookmark-edit', id: b.id, title: title.value, url: url.value }) }
      for (const input of [title, url]) input.onkeydown = (e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') { editingBookmark = null; render() } }
      main.append(node('div', { className: 'row' }, node('span', { className: 'swatch star' }), node('div', { className: 'text' }, title, url),
        node('div', { className: 'actions' }, btn('Save', save, 'primary'), btn('Cancel', () => { editingBookmark = null; render() }))))
      queueMicrotask(() => title.focus())
      continue
    }
    main.append(node('div', { className: 'row' }, node('span', { className: 'swatch star' }),
      node('div', { className: 'text' }, node('div', { className: 'name' }, b.title || b.url), node('div', { className: 'url' }, b.url), ...(b.syncOff ? [node('div', { className: 'chips' }, node('span', { className: 'chip local' }, 'Only on this computer'))] : [])),
      node('div', { className: 'actions' }, btn('Open', () => void run({ type: 'open-url', url: b.url }), 'primary'),
        btn('Edit', () => { editingBookmark = b.id; render() }, '', 'Change the name or the address'),
        btn(b.syncOff ? 'Sync it' : 'Keep here', () => void run({ type: 'bookmark-local', id: b.id, off: !b.syncOff }), b.syncOff ? 'on' : '', b.syncOff ? 'Send this bookmark to Google Drive again' : 'Keep this bookmark on this computer only. It is never sent to Google Drive.'), btn('Remove', () => void run({ type: 'remove-bookmark', id: b.id }), 'danger', 'Removes the bookmark here and on your other computers.'))))
  }

  main.append(node('h2', {}, `History (${view.history.length})`))
  main.append(node('div', { className: 'note' }, 'Pages from Talaria and your other browsers. You can delete what was opened in Talaria. Other browsers keep their own history: it is shown here to read only.'))
  if (view.history.length === 0) main.append(node('div', { className: 'empty' }, 'No history yet.'))
  for (const h of view.history.slice(0, historyShown)) {
    const kind = siteKind(h.url)
    main.append(node('div', { className: 'row' }, node('span', { className: `swatch kind-${kind}`, title: SITE_KIND_TEXT[kind] }),
      node('div', { className: 'text' }, node('div', { className: 'name' }, h.title || h.url), node('div', { className: 'url' }, h.url),
        node('div', { className: 'chips' }, node('span', { className: `chip kind-${kind}` }, SITE_KIND_TEXT[kind]), ...h.sources.map((s) => node('span', { className: 'chip' }, s)), node('span', { className: 'chip' }, when(h.lastVisit)))),
      node('div', { className: 'actions' }, btn('Open', () => void run({ type: 'open-url', url: h.url }), 'primary'),
        ...(h.own ? [btn('Delete', () => void run({ type: 'history-delete', url: h.url }), 'danger', 'Forgets this page in Talaria. Other browsers are not changed.')] : []))))
  }
  if (view.history.length > historyShown) main.append(btn(`Show more (${view.history.length - historyShown})`, () => { historyShown += 50; render() }, '', ''))

  main.append(node('h2', {}, `Bookmarks from your browsers (${view.browserMarks.count})`))
  main.append(node('div', { className: 'note' }, 'Read from the bookmark files of the browsers on this computer, one entry for each address, in the folders they already use. They are shown here to read only: change them in the browser. Turn this on or off in Settings, under Your browsers.'))
  if (view.browserMarks.count === 0) main.append(node('div', { className: 'empty' }, 'No bookmarks found (or this is turned off in Settings).'))
  else main.append(...folderView(view.browserMarks.tree, ''))

  if (view.tabs.length > 0) {
    main.append(node('h2', {}, `Open tabs in your browsers (${view.tabs.length})`))
    main.append(node('div', { className: 'note' }, 'Tabs open right now. "First seen" is when Talaria first noticed the tab: browsers do not say when a tab was made.'))
    for (const b of [...new Set(view.tabs.map((t) => t.browser))]) {
      main.append(node('div', { className: 'device' }, node('div', { className: 'name' }, b)))
      for (const t of view.tabs.filter((x) => x.browser === b)) {
        main.append(node('div', { className: 'row' }, node('span', { className: 'swatch' }),
          node('div', { className: 'text' }, node('div', { className: 'name' }, t.title || t.url), node('div', { className: 'url' }, t.url),
            node('div', { className: 'chips' }, node('span', { className: 'chip' }, `First seen ${when(t.firstSeen)}`))),
          node('div', { className: 'actions' }, btn('Open here', () => void run({ type: 'open-url', url: t.url }), 'primary', 'Opens this page in a Talaria window.'))))
      }
    }
  }

  if (view.devices.length > 0) {
    main.append(node('h2', {}, `Open on your other computers (${view.devices.length})`))
    for (const d of view.devices) {
      main.append(node('div', { className: 'device' }, node('div', { className: 'name' }, d.name), node('div', { className: 'url' }, `Updated ${when(d.updatedAt)}. ${d.tabs.length === 0 ? 'Nothing open.' : ''}`)))
      for (const t of d.tabs) {
        main.append(node('div', { className: 'row' }, node('span', { className: t.kind === 'pin' ? 'swatch released' : 'swatch' }),
          node('div', { className: 'text' }, node('div', { className: 'name' }, t.title || t.url), node('div', { className: 'url' }, `${t.kind === 'pin' ? 'Pin' : 'Window'}. ${t.url}`)),
          node('div', { className: 'actions' }, btn('Open here', () => void run({ type: 'open-url', url: t.url }), 'primary', 'Opens this page in a window on this computer.'))))
      }
    }
  }

  main.append(node('h2', {}, `Archive (${view.archive.length})`))
  if (view.archive.length === 0) main.append(node('div', { className: 'empty' }, 'Nothing here. Pins you remove wait here until you put them back or delete them for good.'))
  for (const r of view.archive) main.append(pinRow(r))

  main.append(node('div', { className: 'note' },
    view.platform === 'darwin'
      ? 'Desktops: macOS does not tell apps the names or numbers of your desktops (Spaces), so pins are listed in one place. A pin you cannot see because its desktop is gone is still here: use Open.'
      : 'Desktops: this system does not share desktop names with apps, so pins are listed in one place.'))
}

api.onChanged(() => { if (renaming === null && editingBookmark === null) void api.get().then((v) => { view = v; render() }) })
void api.get().then((v) => { view = v; render() })
