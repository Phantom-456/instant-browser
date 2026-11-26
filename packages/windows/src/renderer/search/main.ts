import type { BarResults } from '../../shared/ipc'
import { ICONS, mountIcons } from '../shared/icons'
import { platform } from '../shared/platform'
import { isShortcutKey } from '../../shared/shortcutKey'
import { sameItemIndex } from './keepSelection'

interface InstantSearch {
  submit(text: string): void
  cancel(): void
  onShow(callback: () => void): void
  suggest(text: string): Promise<string[]>
  resize(height: number): void
  query(text: string): Promise<BarResults>
  openSettings(section: string): void
  openManager(): void
  onHistoryChanged(callback: () => void): void
}
const api = (window as unknown as { instantSearch: InstantSearch }).instantSearch
const input = document.getElementById('query') as HTMLInputElement
const card = document.getElementById('card') as HTMLElement
const results = document.getElementById('results') as HTMLElement
mountIcons()

const FIELD_HEIGHT = 60 // the text field row
const EMPTY: BarResults = { query: '', searches: [], pages: [] }

/** One thing the user can pick. */
interface Item {
  type: 'search' | 'suggest' | 'page'
  label: string
  /** Text for a search, address for a page, section for a setting. */
  value: string
  sub?: string
  tags?: string[]
}
interface Group { title: string; style: 'bubbles' | 'rows'; items: Item[] }

let local: BarResults = EMPTY // history and settings: instant
let remote: string[] = [] // the search engine's suggestions: later
let typed = '' // what the user typed, kept while arrows move over the list
let flat: Item[] = [] // every item in the order of the screen
let selected = -1 // -1 means the typed text
let timer: number | undefined
let ask = 0 // answers that arrive late are ignored

const SHORT: Record<string, string> = { 'Google Chrome': 'Chrome', 'Microsoft Edge': 'Edge', 'Instant Browser': 'This app' }
const tagsOf = (sources: string[]) => {
  const names = sources.map((s) => SHORT[s] ?? s)
  return names.length > 2 ? [...names.slice(0, 2), `+${names.length - 2}`] : names
}
const hostOf = (url: string) => { try { return new URL(url).host.replace(/^www\./, '') } catch { return url } }

function groups(): Group[] {
  const out: Group[] = []
  const searches: Item[] = local.searches.map((s) => ({ type: 'search', label: s.term, value: s.term, tags: tagsOf(s.sources) }))
  const pages: Item[] = local.pages.map((p) => ({ type: 'page', label: p.title, value: p.url, sub: hostOf(p.url), tags: tagsOf(p.sources) }))
  if (typed.trim() === '') {
    if (searches.length) out.push({ title: 'Recent searches', style: 'bubbles', items: searches })
    if (pages.length) out.push({ title: 'Recently visited', style: 'rows', items: pages })
    return out
  }
  const known = new Set([...searches.map((s) => s.value), typed.trim().toLowerCase()])
  const suggestions: Item[] = remote
    .filter((t) => !known.has(t.toLowerCase()))
    .slice(0, 6)
    .map((t) => ({ type: 'suggest', label: t, value: t }))
  // Your own history comes first: it is about you. The search engine's suggestions follow.
  if (searches.length || pages.length) out.push({ title: 'From your history', style: 'rows', items: [...searches, ...pages] })
  if (suggestions.length) out.push({ title: 'Suggestions', style: 'rows', items: suggestions })
  return out
}

function iconFor(item: Item): string {
  return ICONS[item.type === 'search' ? 'history' : item.type === 'page' ? 'globe' : 'search'] ?? ''
}

function activate(item: Item): void {
  api.submit(item.value)
}

function draw(): void {
  const list = groups()
  flat = list.flatMap((g) => g.items)
  let index = 0
  results.replaceChildren(
    ...list.map((group, g) => {
      const section = document.createElement('section')
      section.className = 'group'
      section.style.setProperty('--g', String(g))
      const title = document.createElement('h2')
      title.textContent = group.title
      const holder = document.createElement(group.style === 'bubbles' ? 'div' : 'ul')
      holder.className = group.style
      for (const item of group.items) {
        const at = index++
        const el = document.createElement(group.style === 'bubbles' ? 'button' : 'li')
        el.className = (group.style === 'bubbles' ? 'bubble' : 'row') + (at === selected ? ' on' : '')
        el.style.setProperty('--i', String(at))
        const ico = document.createElement('span')
        ico.className = 'ico'
        ico.innerHTML = iconFor(item)
        const label = document.createElement('span')
        label.className = 'label'
        label.textContent = item.label
        el.append(ico, label)
        if (item.sub) {
          const sub = document.createElement('span')
          sub.className = 'sub'
          sub.textContent = item.sub
          el.append(sub)
        }
        if (item.tags?.length && group.style === 'rows') {
          const tags = document.createElement('span')
          tags.className = 'tags'
          for (const t of item.tags) {
            const tag = document.createElement('span')
            tag.className = 'tag'
            tag.textContent = t
            tags.append(tag)
          }
          el.append(tags)
        }
        el.onmousedown = (event) => {
          event.preventDefault() // keep the focus in the text field
          activate(item)
        }
        holder.append(el)
      }
      section.append(title, holder)
      return section
    })
  )
  results.hidden = flat.length === 0
  // The window grows or shrinks to fit what is shown.
  api.resize(flat.length ? FIELD_HEIGHT + results.offsetHeight + 1 : FIELD_HEIGHT)
  results.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
}

function select(index: number): void {
  selected = index
  const item = flat[index]
  // Searches and suggestions fill the field, so the user can change them. Pages do not.
  input.value = item && (item.type === 'search' || item.type === 'suggest') ? item.value : typed
  draw()
}

async function refresh(text: string): Promise<void> {
  const mine = ++ask
  window.clearTimeout(timer)
  const answer = await api.query(text) // instant: it comes from memory
  if (mine !== ask) return
  local = answer
  if (!text.trim()) remote = []
  selected = -1
  draw()
  if (!text.trim()) return
  timer = window.setTimeout(() => {
    void api.suggest(text).then((list) => {
      if (mine !== ask) return // the text changed while we waited
      remote = list
      draw()
    })
  }, 90)
}

/** A small X shows on the left, in place of the magnifier, while there is text. Pressing it clears the field. */
const glass = document.getElementById('glass') as HTMLButtonElement
function syncClear(): void {
  const has = input.value.length > 0
  glass.classList.toggle('clear', has)
  glass.innerHTML = (has ? ICONS.close : ICONS.search) ?? ''
  glass.title = has ? 'Clear' : ''
  glass.setAttribute('aria-label', has ? 'Clear the text' : 'Search')
  glass.tabIndex = -1
}
glass.addEventListener('mousedown', (event) => {
  event.preventDefault() // keep the focus in the text field
  if (!glass.classList.contains('clear')) return
  input.value = ''
  typed = ''
  remote = []
  syncClear()
  void refresh('')
  input.focus()
})
syncClear()

input.addEventListener('input', () => {
  typed = input.value
  remote = []
  syncClear()
  void refresh(typed)
})

// Newer history is ready (read in the background): show it without moving what the user is doing.
api.onHistoryChanged(() => {
  const kept = flat[selected]
  const done = refresh(typed)
  const mine = ask // refresh() counts its turn before it waits
  void done.then(() => {
    if (mine !== ask) return // the user typed meanwhile: that answer decides
    const at = sameItemIndex(flat, kept)
    if (at >= 0) { selected = at; draw() }
  })
})

api.onShow(() => {
  card.classList.remove('enter')
  void card.offsetWidth // restart the entrance animation each time the bar opens
  card.classList.add('enter')
  // What was typed last time stays. It is selected, so typing replaces it and one key press clears it.
  typed = input.value
  remote = []
  syncClear()
  void refresh(typed)
  input.focus()
  input.select()
})

input.addEventListener('keydown', (event) => {
  // The same as the bubbles beside the bar: Control+, opens Settings, Control+Shift+P opens the Pin Manager.
  const mod = isShortcutKey(event, platform)
  if (mod && event.key === ',') { event.preventDefault(); api.openSettings('General'); return }
  if (mod && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); api.openManager(); return }
  if (mod && event.key.toLowerCase() === 'w') { event.preventDefault(); api.cancel(); return }
  if (event.key === 'ArrowDown' && flat.length) {
    event.preventDefault()
    select(selected + 1 >= flat.length ? -1 : selected + 1)
  } else if (event.key === 'ArrowUp' && flat.length) {
    event.preventDefault()
    select(selected - 1 < -1 ? flat.length - 1 : selected - 1)
  } else if (event.key === 'Tab' && selected >= 0) {
    event.preventDefault() // keep the choice in the field so the user can change it
    typed = input.value
    void refresh(typed)
  } else if (event.key === 'Enter') {
    const item = flat[selected]
    if (item && item.type === 'page') activate(item)
    else if (input.value.trim()) api.submit(input.value)
  } else if (event.key === 'Escape') {
    api.cancel()
  }
})
