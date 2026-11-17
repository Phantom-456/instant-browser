import type { BubbleAction, BubbleHover } from '../../shared/ipc'
import { SETTINGS_SECTIONS } from '../../shared/bubbles'
import { ICONS } from '../shared/icons'

interface InstantBubble {
  act(action: BubbleAction): void
  hover(hover: BubbleHover): void
}
const api = (window as unknown as { instantBubble: InstantBubble }).instantBubble
const kind = (location.hash.slice(1) === 'manager' ? 'manager' : 'settings') as 'settings' | 'manager'

const bubble = document.getElementById('bubble') as HTMLButtonElement
const flyout = document.getElementById('flyout') as HTMLUListElement

bubble.innerHTML = (kind === 'settings' ? ICONS.general : ICONS.manager) ?? ''
bubble.setAttribute('aria-label', kind === 'settings' ? 'Settings (Command comma)' : 'Pin Manager (Command Shift P)')
bubble.title = kind === 'settings' ? 'Settings (Cmd+,)' : 'Pin Manager (Cmd+Shift+P)'

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
} else {
  bubble.addEventListener('click', () => api.act({ kind: 'manager' }))
}
