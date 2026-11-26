/**
 * Runs the "the bar opened" work once per opening.
 * On the Mac, Electron sends a window's 'show' event only when macOS reports the window as really on screen. When the
 * screen is locked, the screen saver runs, or the display sleeps, the event does not come, so the bar must not depend on
 * it alone. The bar calls open() itself after win.show(), and the 'show' event calls it too; whichever comes first runs
 * the work, the other does nothing. closed() (the bar hid) arms it again for the next opening.
 */
export class OncePerOpening {
  private done = false
  private readonly listeners: Array<() => void> = []

  add(cb: () => void): void { this.listeners.push(cb) }

  open(): void {
    if (this.done) return
    this.done = true
    for (const cb of this.listeners) cb()
  }

  closed(): void { this.done = false }
}
