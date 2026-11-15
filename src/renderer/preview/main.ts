import type { PreviewAction, PreviewState } from '../../shared/ipc'

interface InstantPreview {
  act(action: PreviewAction): void
  onState(callback: (state: PreviewState) => void): void
}
const api = (window as unknown as { instantPreview: InstantPreview }).instantPreview
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const shot = el<HTMLImageElement>('shot')
const text = el<HTMLSpanElement>('text')
const buttons = el<HTMLSpanElement>('buttons')

el('retry').addEventListener('click', () => api.act({ type: 'retry' }))
el('cancel').addEventListener('click', () => api.act({ type: 'cancel' }))

const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

api.onState((state) => {
  if (state.image) {
    shot.src = state.image
    shot.hidden = false
  }
  document.body.classList.toggle('failed', state.status === 'failed')
  document.body.classList.toggle('done', state.status === 'done')
  buttons.hidden = state.status !== 'failed'
  const taken = state.takenAt ? ` (saved ${clock(state.takenAt)})` : ''
  text.textContent =
    state.status === 'failed' ? state.message || 'The page did not load.'
    : state.status === 'slow' ? `Saved preview${taken} · Still loading…`
    : `Saved preview${taken} · Updating live page…`
})
