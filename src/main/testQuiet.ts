import { BaseWindow, app } from 'electron'

/**
 * Quiet mode for the automatic tests (INSTANT_TEST_QUIET=1). The tests start the real app and drive it, so it opens real windows.
 * That flashed windows over the screen and took the mouse and the keyboard of the person at the computer. In quiet mode every window
 * is fully see-through, ignores the real mouse, and never takes focus. The program still sees the windows as visible, with their
 * real sizes and places, so what the tests check is the same. The tests send their own mouse and key events into the pages.
 */
export function installQuietWindows(): void {
  const proto = BaseWindow.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
  const original = {
    setOpacity: proto.setOpacity!,
    showInactive: proto.showInactive!,
    setIgnoreMouseEvents: proto.setIgnoreMouseEvents!
  }
  const hide = (win: unknown) => {
    original.setOpacity.call(win, 0)
    original.setIgnoreMouseEvents.call(win, true) // the real mouse goes through
  }
  proto.show = function (this: unknown) { hide(this); return original.showInactive.call(this) } // shown without taking focus
  proto.showInactive = function (this: unknown) { hide(this); return original.showInactive.call(this) }
  proto.focus = function () { /* a test window never takes the keyboard */ }
  // Asking a page to focus itself would also make its window the key window.
  app.on('web-contents-created', (_event, contents) => { contents.focus = () => {} })
  proto.setOpacity = function (this: unknown) { /* animations must not make a window visible again */ }
  proto.setIgnoreMouseEvents = function (this: unknown) { original.setIgnoreMouseEvents.call(this, true) } // the pages ask for clicks, but only injected ones count
}
