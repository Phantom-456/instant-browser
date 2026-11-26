import { isSecureUrl, prettyUrl } from '../../shared/prettyUrl'
import type { ToolbarAction, ToolbarState } from '../../shared/ipc'
import { mountIcons, ICONS } from '../shared/icons'

interface InstantToolbar {
  action(action: ToolbarAction): void
  onState(callback: (state: ToolbarState) => void): void
}
const api = (window as unknown as { instantToolbar: InstantToolbar }).instantToolbar
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// On Mac the window buttons sit on the left of the toolbar, so keep that space free.
if (/Mac/i.test(navigator.platform)) document.body.classList.add('mac')
mountIcons()

const back = el<HTMLButtonElement>('back')
const forward = el<HTMLButtonElement>('forward')
const reload = el<HTMLButtonElement>('reload')
const collapse = el<HTMLButtonElement>('collapse')
const follow = el<HTMLButtonElement>('follow')
const bookmark = el<HTMLButtonElement>('bookmark')
const send = el<HTMLButtonElement>('send')
const pick = el<HTMLButtonElement>('pick')
const close = el<HTMLButtonElement>('close')
const url = el<HTMLInputElement>('url')
const lock = el<HTMLSpanElement>('lock')
const progress = el<HTMLDivElement>('progress')
const spin = el<HTMLSpanElement>('spin')
const address = el<HTMLLabelElement>('address')
const error = el<HTMLDivElement>('error')

back.onclick = () => api.action({ type: 'back' })
forward.onclick = () => api.action({ type: 'forward' })
reload.onclick = () => api.action({ type: 'reload' })
collapse.onclick = () => api.action({ type: 'collapse' })
follow.onclick = () => api.action({ type: 'follow' })
bookmark.onclick = () => api.action({ type: 'bookmark' })
send.onclick = () => api.action({ type: 'send' })
pick.onclick = () => api.action({ type: 'pick-browser' })
close.onclick = () => api.action({ type: 'close' })

// The field shows a short label. When you click it, it shows the full address to edit.
let fullUrl = ''
const showLabel = () => { url.value = prettyUrl(fullUrl) || fullUrl }
url.addEventListener('focus', () => { url.value = fullUrl; url.select() })
url.addEventListener('blur', showLabel)
url.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && url.value.trim()) {
    api.action({ type: 'navigate', text: url.value })
    url.blur()
  } else if (event.key === 'Escape') {
    url.blur()
  }
})

api.onState((state) => {
  fullUrl = state.url
  if (document.activeElement !== url) showLabel()
  document.title = state.title
  back.disabled = !state.canGoBack
  forward.disabled = !state.canGoForward
  bookmark.classList.toggle('on', state.bookmarked)
  bookmark.innerHTML = (state.bookmarked ? ICONS.starFill : ICONS.star) ?? ''
  bookmark.title = state.bookmarked ? 'Bookmarked. Click to remove the bookmark.' : 'Bookmark this page'
  follow.classList.toggle('on', state.following)
  follow.title = state.following ? 'Following you to other desktops. Click to stay on this desktop.' : 'Follow me to other desktops'
  reload.innerHTML = state.loading ? ICONS.stop! : ICONS.reload!
  reload.title = state.loading ? 'Stop' : 'Reload'
  lock.hidden = state.loading || !isSecureUrl(state.url) // while loading, the spinner takes the place of the lock
  spin.hidden = !state.loading
  progress.hidden = !state.loading
  address.classList.toggle('loading', state.loading)
  error.hidden = !state.error
  error.textContent = state.error ? `${state.error}. Press reload to try again.` : ''
})
