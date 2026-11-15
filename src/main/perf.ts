import { monitorEventLoopDelay } from 'node:perf_hooks'

/** Timers for finding slow spots. They print only when INSTANT_PERF=1 is set. */
const on = process.env.INSTANT_PERF === '1'
const start = Date.now()

export function perf(label: string, detail = ''): void {
  if (on) console.log(`[perf] +${Date.now() - start}ms ${label}${detail ? ' ' + detail : ''}`)
}

/** Say when the main thread was blocked for more than 50 ms: that is when the app feels stuck. */
export function watchMainThread(): void {
  if (!on) return
  const histogram = monitorEventLoopDelay({ resolution: 10 })
  histogram.enable()
  setInterval(() => {
    const worst = Math.round(histogram.max / 1e6)
    if (worst > 50) perf('main thread blocked', `${worst}ms`)
    histogram.reset()
  }, 500).unref()
}
