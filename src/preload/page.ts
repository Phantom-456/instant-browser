import { ipcRenderer } from 'electron'
import { feedSwipe, newSwipe, swipeEnded, type SwipeDirection } from '../shared/swipe'

/*
 * Runs in every web page of Talaria (a session preload script). It gives the page nothing to call and reads
 * nothing from it. It only watches the trackpad: a two-finger swipe sideways shows an elastic arrow at the edge, and
 * past the line it asks the main process to go back or forward. Like Chrome: only when the page cannot scroll sideways
 * in that direction, and not when the page handled the scroll itself.
 */

// A sandboxed preload cannot load other files, so the channel names are written here.
// tests/unit/preloadChannels.test.ts checks that they match src/shared/ipc.ts.
const PAGE_SWIPE = 'page:swipe'
const PAGE_SWIPE_CAN = 'page:swipe-can'

if (window === window.top) {
  let state = newSwipe()
  let timer: number | undefined
  const gate: { allowed: boolean | null; asked: SwipeDirection | null } = { allowed: null, asked: null } // can the history go this way? asked once for each swipe
  let host: HTMLDivElement | null = null
  let bubble: HTMLDivElement | null = null

  /** Can something under the pointer scroll sideways in this direction? Then the swipe belongs to the page. */
  const pageScrolls = (target: EventTarget | null, dx: number): boolean => {
    let el = target instanceof Element ? target : null
    while (el && el !== document.documentElement) {
      const style = getComputedStyle(el)
      if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        const atStart = el.scrollLeft <= 0
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
        if ((dx < 0 && !atStart) || (dx > 0 && !atEnd)) return true
      }
      el = el.parentElement
    }
    const root = document.scrollingElement
    if (root && root.scrollWidth > root.clientWidth + 1) {
      if ((dx < 0 && root.scrollLeft > 0) || (dx > 0 && root.scrollLeft + root.clientWidth < root.scrollWidth - 1)) return true
    }
    return false
  }

  const ensureBubble = (): HTMLDivElement => {
    if (bubble && host?.isConnected) return bubble
    host = document.createElement('div')
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
    const root = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = `
      .b { position: fixed; top: 50%; width: 44px; height: 44px; margin-top: -22px; border-radius: 50%; display: grid; place-items: center;
           font: 600 22px/1 -apple-system, system-ui, sans-serif; color: #fff; background: rgba(40, 40, 46, 0.86); box-shadow: 0 6px 22px rgba(0,0,0,0.35);
           opacity: 0; will-change: transform, opacity; }
      .b.snap { transition: transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease-out; }
      @media (prefers-reduced-motion: reduce) { .b.snap { transition: opacity 0.1s linear; } }`
    bubble = document.createElement('div')
    bubble.className = 'b'
    root.append(style, bubble)
    document.documentElement.append(host)
    return bubble
  }

  /** Draw the bubble: it is pulled in from the edge as the swipe goes on, and snaps back (elastic) when it ends. */
  const draw = (direction: SwipeDirection | null, progress: number): void => {
    const b = ensureBubble()
    if (!direction || progress <= 0) {
      b.classList.add('snap')
      b.style.opacity = '0'
      b.style.transform = `translateX(${b.dataset.side === 'right' ? 70 : -70}px)`
      return
    }
    const back = direction === 'back'
    b.dataset.side = back ? 'left' : 'right'
    b.textContent = back ? '‹' : '›'
    b.style.left = back ? '0' : 'auto'
    b.style.right = back ? 'auto' : '0'
    b.classList.remove('snap')
    // Rubber band: it moves a lot at first and less near the end.
    const pull = 70 * (1 - Math.pow(1 - progress, 2))
    b.style.opacity = String(Math.min(1, 0.25 + progress))
    b.style.transform = `translateX(${back ? pull - 56 : 56 - pull}px) scale(${0.85 + 0.2 * progress})`
    b.style.background = progress >= 1 ? 'rgba(47, 124, 246, 0.95)' : 'rgba(40, 40, 46, 0.86)'
  }

  const finish = (): void => {
    timer = undefined
    draw(null, 0)
    gate.allowed = null
    gate.asked = null
  }

  window.addEventListener(
    'wheel',
    (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.deltaMode !== 0) return // the page used it, or it is a pinch zoom
      const update = feedSwipe(state, event.deltaX, event.deltaY, performance.now())
      state = update.state
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => { if (swipeEnded(state, performance.now())) finish() }, 170)
      if (!update.active || !update.direction) return
      if (pageScrolls(event.target, state.sumX)) { draw(null, 0); return }
      if (gate.asked !== update.direction) {
        gate.asked = update.direction
        gate.allowed = null
        void ipcRenderer.invoke(PAGE_SWIPE_CAN, update.direction).then((ok: boolean) => { gate.allowed = ok === true })
      }
      const blocked = (gate as { allowed: boolean | null }).allowed === false // the answer may have come in meanwhile
      if (blocked) return // nothing to go back to: no bubble
      draw(update.direction, update.progress)
      if (update.fire) ipcRenderer.send(PAGE_SWIPE, update.direction)
    },
    { passive: true }
  )
}
