import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { parseWinKeyLine, winKeyHelperArgs } from '../shared/winKeys'

export interface WinKeyAnswer {
  mask: number | null
  frontApp: string | null
}

/**
 * Keeps one PowerShell helper running and asks it which keys are held. Any failure answers null: the link router
 * then opens the link in a small window, so no link is lost. A helper that dies is started again on the next question.
 */
export class WinKeyReader {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<boolean> | null = null
  private buffer = ''
  private waiting: Array<(line: string | null) => void> = []
  /** Starts that ended before the helper said "ready". After MAX_FAILED_STARTS it is not tried again. */
  private failedStarts = 0

  constructor(private readonly command = 'powershell.exe') {}

  /** Starts the helper now, so the first link does not wait for it. */
  start(): Promise<boolean> {
    if (this.ready) return this.ready
    // PowerShell can be blocked (for example Constrained Language Mode stops Add-Type). Then each link would wait
    // for a helper that never works, so after a few failed starts it is not tried again until the app restarts.
    if (this.failedStarts >= MAX_FAILED_STARTS) return Promise.resolve(false)
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(this.command, winKeyHelperArgs(), { windowsHide: true })
    } catch {
      return Promise.resolve(false)
    }
    this.child = child
    this.ready = new Promise<boolean>((resolve) => {
      let first = true
      const end = () => {
        if (first) {
          this.failedStarts++
          resolve(false)
        }
        first = false
        if (this.child === child) this.stop()
      }
      child.on('error', end)
      child.on('exit', end)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (data: string) => {
        this.buffer += data
        let at: number
        while ((at = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, at).replace(/\r$/, '')
          this.buffer = this.buffer.slice(at + 1)
          if (first) {
            first = false
            if (line === 'ready') this.failedStarts = 0
            else this.failedStarts++
            resolve(line === 'ready')
          } else this.waiting.shift()?.(line)
        }
      })
    })
    return this.ready
  }

  /** The keys held and the app in front now, or nulls when they cannot be read within the time limit. */
  async read(timeoutMs = 1500): Promise<WinKeyAnswer> {
    const none = { mask: null, frontApp: null }
    const started = await Promise.race([this.start(), delay(timeoutMs * 4).then(() => false)])
    const child = this.child
    if (!started || !child) return none
    const line = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(answer)
        if (i >= 0) this.waiting[i] = () => {} // keep the order: the late answer is dropped
        resolve(null)
      }, timeoutMs)
      const answer = (l: string | null) => {
        clearTimeout(timer)
        resolve(l)
      }
      this.waiting.push(answer)
      try {
        child.stdin.write('?\n')
      } catch {
        answer(null)
      }
    })
    return line === null ? none : parseWinKeyLine(line)
  }

  stop(): void {
    const child = this.child
    this.child = null
    this.ready = null
    this.buffer = ''
    for (const w of this.waiting.splice(0)) w(null)
    if (child && child.exitCode === null) {
      try {
        child.stdin.end()
        child.kill()
      } catch {
        // already gone
      }
    }
  }
}

/** How many failed starts in a row before the helper is given up for this run of the app. */
export const MAX_FAILED_STARTS = 3

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
