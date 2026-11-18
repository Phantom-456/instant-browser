import type { BubbleAction, BubbleHover } from '../../shared/ipc'
import { SETTINGS_SECTIONS } from '../../shared/bubbles'
import { ICONS } from '../shared/icons'

interface InstantBubble {
  act(action: BubbleAction): void
  hover(hover: BubbleHover): void
}
const api = (window as unknown as { instantBubble: InstantBubble }).instantBubble
const hash = location.hash.slice(1)
const kind = (hash === 'manager' ? 'manager' : hash === 'sync' ? 'sync' : 'settings') as 'settings' | 'manager' | 'sync'

const bubble = document.getElementById('bubble') as HTMLButtonElement
const flyout = document.getElementById('flyout') as HTMLUListElement

bubble.innerHTML = (kind === 'settings' ? ICONS.general : kind === 'sync' ? ICONS.sync : ICONS.manager) ?? ''
const names = { settings: ['Settings (Command comma)', 'Settings (Cmd+,)'], sync: ['Sync now (Command Shift S)', 'Sync now (Cmd+Shift+S)'], manager: ['Pin Manager (Command Shift P)', 'Pin Manager (Cmd+Shift+P)'] } as const
bubble.setAttribute('aria-label', names[kind][0])
bubble.title = names[kind][1]

if (kind === 'settings') {
  // Hover shows the sections; a click on the bubble opens Settings, a click on a section opens that section.
  for (const section of SETTINGS_SECTIONS) {
    const item = document.createElement('li')
    item.textContent = section
    item.setAttribute('role', 'menuitem')
    item.addEventListener('click', () => api.act({ kind: 'settings', section }))
    flyout.append(item)
  }
  flyout.hidden = false
  document.body.addEventListener('mouseenter', () => { document.body.classList.add('open'); api.hover({ kind, on: true }) })
  document.body.addEventListener('mouseleave', () => { document.body.classList.remove('open'); api.hover({ kind, on: false }) })
  bubble.addEventListener('click', () => api.act({ kind: 'settings', section: 'General' }))
} else if (kind === 'sync') {
  // Syncs now, or opens the Sync settings when Google Drive is not connected yet. The bar stays open.
  bubble.addEventListener('click', () => {
    api.act({ kind: 'sync' })
    bubble.classList.add('spin')
    setTimeout(() => bubble.classList.remove('spin'), 1200)
  })
} else {
  bubble.addEventListener('click', () => api.act({ kind: 'manager' }))
}
