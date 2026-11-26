import type { PinEvent, PinView } from '../../shared/ipc'
import { ICONS } from '../shared/icons'
import '../shared/platform'

interface InstantPin {
  send(event: PinEvent): void
  onState(callback: (view: PinView) => void): void
}
const api = (window as unknown as { instantPin: InstantPin }).instantPin
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const circle = el<HTMLButtonElement>('circle')
const description = el<HTMLDivElement>('description')
const follow = el<HTMLButtonElement>('follow')
const offload = el<HTMLButtonElement>('offload')
const remove = el<HTMLButtonElement>('remove')
const live = el<HTMLDivElement>('live')
const edge = document.getElementById('edge') as unknown as SVGSVGElement
const gradient = document.getElementById('pg') as unknown as SVGLinearGradientElement

follow.innerHTML = ICONS.follow ?? ''
el<HTMLSpanElement>('offload-icon').innerHTML = ICONS.offload ?? ''
const cd = offload.querySelector('.cd') as SVGSVGElement
const cdLeft = offload.querySelector('.left') as SVGCircleElement
remove.innerHTML = ICONS.close ?? ''
const iconEl = el<HTMLSpanElement>('icon')
let shownIcon: string | null | undefined
/** The website's own icon when it has one; otherwise the same pin icon as the toolbar button. */
function setIcon(icon: string | null): void {
  if (icon === shownIcon) return
  shownIcon = icon
  if (icon) {
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false // a picture can be dragged out of a page; this one must not, or the pin cannot be dragged
    img.addEventListener('dragstart', (e) => e.preventDefault())
    img.src = icon
    img.onerror = () => { shownIcon = undefined; setIcon(null) } // a broken picture falls back to the pin icon
    iconEl.replaceChildren(img)
  } else {
    iconEl.innerHTML = ICONS.collapse ?? ''
  }
}
setIcon(null)

const rename = el<HTMLInputElement>('rename')
const labelEl = el<HTMLSpanElement>('label')
let editing = false
// Electron cannot show a window on every Windows virtual desktop, so Follow is a Mac feature for now (windows-plan W12).
if (!/Mac/i.test(navigator.platform)) follow.style.display = 'none'
let view: PinView | null = null
let announced = ''

type Box = { x: number; y: number; width: number; height: number }
const place = (node: HTMLElement, box: Box) => {
  node.style.left = `${box.x}px`
  node.style.top = `${box.y}px`
  node.style.width = `${box.width}px`
  node.style.height = `${box.height}px`
}
/** Where a part starts from when it opens: the centre of the circle. */
const fromCircle = (node: HTMLElement, box: Box, c: Box) => {
  node.style.setProperty('--dx', `${c.x + c.width / 2 - (box.x + box.width / 2)}px`)
  node.style.setProperty('--dy', `${c.y + c.height / 2 - (box.y + box.height / 2)}px`)
}

function announce(text: string): void {
  if (text === announced) return
  announced = text
  live.textContent = text
}

function render(next: PinView): void {
  view = next
  const root = document.documentElement
  root.style.setProperty('--d', `${next.d}px`)
  root.style.setProperty('--gradient', next.gradient)
  root.style.setProperty('--accent', next.accent)
  root.style.setProperty('--ink-on', next.ink === 'black' ? '#111' : '#fff')
  root.dataset.theme = next.dark ? 'dark' : 'light'
  setIcon(next.icon)
  root.style.setProperty('--arm', `${next.armMs}ms`)

  // The gradient for the borders that draw themselves (SVG), from the pin's own colours and angle.
  const rad = ((next.angle - 90) * Math.PI) / 180
  gradient.setAttribute('x1', String(0.5 - Math.cos(rad) / 2))
  gradient.setAttribute('y1', String(0.5 - Math.sin(rad) / 2))
  gradient.setAttribute('x2', String(0.5 + Math.cos(rad) / 2))
  gradient.setAttribute('y2', String(0.5 + Math.sin(rad) / 2))
  gradient.replaceChildren(
    ...next.stops.map((color, i) => {
      const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
      stop.setAttribute('offset', String(next.stops.length === 1 ? 0 : i / (next.stops.length - 1)))
      stop.setAttribute('stop-color', color)
      return stop
    })
  )

  place(circle, next.circle)
  circle.dataset.state = next.state
  circle.dataset.phase = next.phase
  circle.dataset.dragging = String(next.dragging)
  circle.setAttribute('aria-label', `${next.label}. ${next.state === 'offloaded' ? 'Page released. Opens and reloads it.' : 'Opens the page.'}`)

  document.body.dataset.open = String(next.parts !== null && next.phase !== 'idle')
  document.body.dataset.phase = next.phase

  if (next.parts) {
    const p = next.parts
    place(description, p.description)
    description.dataset.side = p.side
    // The capsule's border is an SVG rectangle with fully round ends.
    const w = p.description.width
    const h = p.description.height
    edge.setAttribute('viewBox', `0 0 ${w} ${h}`)
    for (const rect of Array.from(edge.querySelectorAll('rect'))) {
      rect.setAttribute('x', '1')
      rect.setAttribute('y', '1')
      rect.setAttribute('width', String(w - 2))
      rect.setAttribute('height', String(h - 2))
      rect.setAttribute('rx', String((h - 2) / 2))
    }
    fromCircle(description, p.description, next.circle)
    labelEl.textContent = next.label
    el('address').textContent = next.address
    for (const [node, box] of [[follow, p.follow], [offload, p.offload], [remove, p.remove]] as const) {
      place(node, box)
      fromCircle(node, box, next.circle)
    }
  }
  follow.setAttribute('aria-label', next.following ? 'Stop following me to other desktops' : 'Follow me to other desktops')
  follow.setAttribute('aria-pressed', String(next.following))
  follow.title = follow.getAttribute('aria-label') ?? ''
  offload.setAttribute('aria-label', 'Offload: release this page from memory')
  // The countdown ring: a ring that runs down (running), a dashed ring (paused or waiting), nothing (off).
  offload.dataset.countdown = next.countdown.mode
  cd.style.display = next.countdown.mode === 'off' ? 'none' : ''
  cdLeft.setAttribute('stroke-dasharray', next.countdown.mode === 'running' ? `${Math.max(0.01, next.countdown.fraction)} 1` : '0.07 0.05')
  offload.title = `Drag this toward the pin to offload. ${next.countdown.label}`
  remove.setAttribute('aria-label', 'Remove this pin')
  remove.title = 'Remove (kept in the archive)'
  // The main process says when the name is being edited (it also gives the window the keyboard).
  if (next.renaming && !editing) beginEdit(next)
  if (!next.renaming && editing) endEdit()
  announce(next.phase === 'armed' ? `${next.label} pin is ready` : '')
}

function beginEdit(next: PinView): void {
  editing = true
  rename.value = next.customLabel || next.label
  rename.hidden = false
  labelEl.hidden = true
  description.classList.add('editing') // a small spring: the capsule grows a little
  rename.focus()
  rename.select()
}
function endEdit(): void {
  editing = false
  rename.hidden = true
  labelEl.hidden = false
  description.classList.remove('editing')
}
let sent = false
const commit = () => { if (editing && !sent) { sent = true; api.send({ type: 'rename-commit', text: rename.value }) } }
rename.addEventListener('keydown', (event) => {
  event.stopPropagation()
  if (event.key === 'Enter') { event.preventDefault(); commit() }
  else if (event.key === 'Escape') { event.preventDefault(); sent = true; api.send({ type: 'rename-cancel' }) }
})
rename.addEventListener('blur', commit) // losing focus saves
// A click on the name (when the pin is ready) starts editing. F2 does the same from the keyboard.
description.addEventListener('click', () => { if (!editing && view?.phase === 'armed') { sent = false; api.send({ type: 'rename-start' }) } })
document.addEventListener('keydown', (event) => { if (event.key === 'F2' && !editing && view?.phase === 'armed') { sent = false; api.send({ type: 'rename-start' }) } })

api.onState(render)

// ---- Pointer: tell the main process when the pointer is on the pin ----
const inflate = 8 // the small gaps between the capsule and the bubbles count as the pin too
const hit = (box: Box, x: number, y: number, pad = 0) =>
  x >= box.x - pad && x <= box.x + box.width + pad && y >= box.y - pad && y <= box.y + box.height + pad

function overCircle(box: Box, x: number, y: number): boolean {
  const r = box.width / 2
  return Math.hypot(x - (box.x + r), y - (box.y + r)) <= r
}

let lastInside = false
function pointer(x: number, y: number): void {
  if (!view) return
  const open = view.phase !== 'idle' // also while arming: the opened capsule and bubbles are part of the pin
  const parts = open ? view.parts : null
  const inside =
    overCircle(view.circle, x, y) ||
    (open && parts !== null && [parts.description, parts.follow, parts.offload, parts.remove].some((b) => hit(b, x, y, inflate)))
  if (inside !== lastInside) {
    lastInside = inside
    api.send({ type: 'pointer', inside })
  }
}
document.addEventListener('mousemove', (event) => pointer(event.clientX, event.clientY))
document.addEventListener('mouseleave', () => {
  if (lastInside) { lastInside = false; api.send({ type: 'pointer', inside: false }) }
})

// ---- The circle: a click restores, a drag moves ----
const DRAG_START = 4
circle.addEventListener('dragstart', (event) => event.preventDefault()) // never a picture drag from the pin
circle.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  const startX = event.screenX
  const startY = event.screenY
  let dragging = false
  circle.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent) => {
    if (!dragging && Math.hypot(e.screenX - startX, e.screenY - startY) >= DRAG_START) {
      dragging = true
      api.send({ type: 'drag-start', x: startX, y: startY })
    }
    if (dragging) api.send({ type: 'drag-move', x: e.screenX, y: e.screenY })
  }
  const up = () => {
    circle.removeEventListener('pointermove', move)
    circle.removeEventListener('pointerup', up)
    circle.removeEventListener('pointercancel', up)
    if (dragging) api.send({ type: 'drag-end' })
    else api.send({ type: 'restore' })
  }
  circle.addEventListener('pointermove', move)
  circle.addEventListener('pointerup', up)
  circle.addEventListener('pointercancel', up)
})
circle.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); api.send({ type: 'restore' }) }
})

// ---- The bubbles ----
follow.addEventListener('click', () => api.send({ type: 'follow' }))
remove.addEventListener('click', () => api.send({ type: 'remove' }))

// Offload: drag the bubble toward the pin to offload; a plain click pauses or resumes the countdown.
offload.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !view) return
  const startX = event.clientX
  const startY = event.clientY
  const from = { x: view.parts ? view.parts.offload.x + view.parts.offload.width / 2 : startX, y: view.parts ? view.parts.offload.y + view.parts.offload.height / 2 : startY }
  const to = { x: view.circle.x + view.circle.width / 2, y: view.circle.y + view.circle.height / 2 }
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
  let moved = false
  offload.setPointerCapture(event.pointerId)
  const progress = (e: PointerEvent) => ((e.clientX - startX) * (to.x - from.x) + (e.clientY - startY) * (to.y - from.y)) / (length * length)
  const move = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true
    if (moved) {
      const p = Math.min(1, Math.max(0, progress(e)))
      offload.style.transform = `translate(${(to.x - from.x) * p}px, ${(to.y - from.y) * p}px)`
    }
  }
  const up = (e: PointerEvent) => {
    offload.removeEventListener('pointermove', move)
    offload.removeEventListener('pointerup', up)
    offload.removeEventListener('pointercancel', up)
    offload.style.transform = ''
    if (!moved) api.send({ type: 'offload-toggle' })
    else if (e.type === 'pointerup' && progress(e) >= 0.55) api.send({ type: 'offload' })
  }
  offload.addEventListener('pointermove', move)
  offload.addEventListener('pointerup', up)
  offload.addEventListener('pointercancel', up)
})
// Right-click on a paused countdown: go on.
offload.addEventListener('contextmenu', (event) => { event.preventDefault(); api.send({ type: 'offload-resume' }) })
// Keyboard: Space pauses or resumes, Option+Return offloads.
offload.addEventListener('keydown', (event) => {
  if (event.key === ' ') { event.preventDefault(); api.send({ type: 'offload-toggle' }) }
  else if (event.key === 'Enter' && event.altKey) { event.preventDefault(); api.send({ type: 'offload' }) }
})
