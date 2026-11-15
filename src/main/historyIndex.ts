import { utilityProcess, type UtilityProcess } from 'electron'
import { rmSync, statSync } from 'node:fs'
import { buildHistory, findHistory, mergeHistory, recentPages, recentSearches, type History, type RawVisit } from '../shared/history'
import { DEFAULT_BUBBLES, matchBubbles } from '../shared/bubbles'
import type { BarResults } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import type { ScanRequest, ScanResult } from './historyWorker'
import workerPath from './historyWorker?modulePath'
import { configuredSources, listHistoryFiles } from './historyReader'
import type { OwnHistory } from './ownHistory'
import { isTestMode } from './testMode'
import { perf } from './perf'

/** Look for changed history files at most this often. */
const CHECK_EVERY_MS = 5 * 60_000
const empty = (): History => ({ searches: [], pages: [] })

/**
 * History from all browsers, held in memory. A separate process reads the files, so the app never freezes.
 * Old data is shown at once, and the search bar is told when newer data is ready.
 */
export class HistoryIndex {
  private history: History = empty()
  private signature = ''
  private lastCheck = 0
  private child: UtilityProcess | null = null
  private again = false
  private stopped = false

  constructor(
    private readonly getSettings: () => Settings,
    private readonly own: OwnHistory,
    private readonly cachePath: string,
    /** Called when the data changed, so an open search bar can update itself. */
    private readonly onChange: () => void
  ) {}

  /** Start: shows what is saved from last time, then reads only the files that changed. */
  start(): void {
    this.scan()
  }

  /** Called when the search bar opens. Costs almost nothing: it only looks at the size and time of the files. */
  refreshIfChanged(): void {
    const every = isTestMode() && process.env.INSTANT_TEST_CHECK_MS ? Number(process.env.INSTANT_TEST_CHECK_MS) : CHECK_EVERY_MS
    if (Date.now() - this.lastCheck < every) return
    this.lastCheck = Date.now()
    if (this.currentSignature() !== this.signature) this.scan()
  }

  /** After a setting changed (history on or off, a browser left out). */
  rescan(): void {
    this.scan()
  }

  /** Something was opened from the search bar. It shows in the history at once. */
  noteOwnVisit(url: string): void {
    const now = Date.now()
    const row: RawVisit = { url, title: '', visits: 1, lastVisit: now, source: 'Instant Browser' }
    this.history = mergeHistory(this.history, buildHistory([row]))
  }

  /** Delete the saved copy of the history. */
  clearCache(): void {
    rmSync(this.cachePath, { force: true })
  }

  /** The app is quitting: stop the other process and ignore what it still sends. */
  stop(): void {
    this.stopped = true
    this.again = false
    this.child?.kill()
    this.child = null
  }

  private enabledSources() {
    const s = this.getSettings()
    return s.showHistory ? configuredSources().filter((x) => !s.historyOff.includes(x.name)) : []
  }

  /** Size and time of every history file: it changes when a browser writes to its history. */
  private currentSignature(): string {
    const parts: string[] = []
    for (const source of this.enabledSources()) {
      for (const path of listHistoryFiles(source)) {
        try {
          const st = statSync(path)
          parts.push(`${path}:${st.size}:${Math.round(st.mtimeMs)}`)
        } catch { /* gone */ }
      }
    }
    return parts.join('|')
  }

  private scan(): void {
    if (this.stopped) return
    if (this.child) { this.again = true; return } // one scan at a time; run once more when it ends
    const sources = this.enabledSources()
    if (sources.length === 0) {
      // History is off (or no browser has history): only what was opened here.
      if (!this.getSettings().showHistory) this.clearCache()
      this.history = buildHistory(this.own.rows())
      this.signature = ''
      this.onChange()
      return
    }
    this.signature = this.currentSignature()
    this.lastCheck = Date.now()
    perf('history: scan starts (separate process)')
    const child = utilityProcess.fork(workerPath, [], { serviceName: 'Instant Browser history', stdio: 'ignore' })
    this.child = child
    child.on('message', (message: ScanResult) => {
      if (this.stopped || message?.type !== 'result') return
      this.history = message.history
      perf(`history: ${message.stage} data ready`, `reused ${message.stats.reused} files, read ${message.stats.read} files, ${message.stats.ms}ms in the other process`)
      this.onChange()
      if (message.stage === 'fresh') child.kill()
    })
    child.on('exit', () => {
      if (this.child === child) this.child = null
      if (this.again && !this.stopped) { this.again = false; this.scan() }
    })
    const request: ScanRequest = { type: 'scan', sources, cachePath: this.cachePath, own: this.own.rows() }
    child.postMessage(request)
  }

  /** Local results, ready at once. Remote suggestions come separately. */
  query(text: string, now = Date.now()): BarResults {
    const q = text.trim()
    const showHistory = this.getSettings().showHistory
    if (q === '') {
      return {
        query: q,
        settings: DEFAULT_BUBBLES,
        searches: showHistory ? recentSearches(this.history, 8, now).map((s) => ({ term: s.term, sources: s.sources })) : [],
        pages: showHistory ? recentPages(this.history, 4, now).map((p) => ({ title: p.title, url: p.url, sources: p.sources })) : []
      }
    }
    const found = showHistory ? findHistory(this.history, q, now, { searches: 4, pages: 4 }) : { searches: [], pages: [] }
    return {
      query: q,
      settings: matchBubbles(q),
      searches: found.searches.map((s) => ({ term: s.term, sources: s.sources })),
      pages: found.pages.map((p) => ({ title: p.title, url: p.url, sources: p.sources }))
    }
  }
}
