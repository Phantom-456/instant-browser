import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildFolderTree, mergeMarks, type BrowserMark, type MarkFolder, type MergedMark } from '../shared/browserBookmarks'
import type { Settings } from '../shared/settings'
import { isPermissionError, parseTabOutput, stampTabs, tabScript, TAB_BROWSERS, type LiveTab, type RawTab, type TabBrowser, type TabBrowserStatus } from '../shared/liveTabs'
import { bookmarkFile, profileDirs, readBrowserMarks } from './browserBookmarks'
import { configuredSources } from './historyReader'
import { isTestMode } from './testMode'

const run = promisify(execFile)
/** After the last change to a file, wait this long before reading it again (browsers write in bursts). */
const BOOKMARK_QUIET_MS = 1500
const HISTORY_QUIET_MS = 8000
const TABS_EVERY_MS = 10_000

type TabAnswer = { state: 'ok'; text: string } | { state: 'not-running' | 'denied' | 'error' }

/**
 * What Talaria knows about the other browsers on this computer: their bookmarks (merged by address, with a copy kept
 * in Talaria's own folder), a watch on their files, and their open tabs (only when the user turned that on).
 * It only reads. It never writes to a browser, and it never reads cookies or passwords.
 */
export class BrowserLibrary {
  private marks: MergedMark[] = []
  private tabs: LiveTab[] = []
  private tabStatus: TabBrowserStatus[] = []
  private seen: Record<string, number> = {}
  private watchers: FSWatcher[] = []
  private watchKey = ''
  private marksTimer: NodeJS.Timeout | null = null
  private historyTimer: NodeJS.Timeout | null = null
  private tabTimer: NodeJS.Timeout | null = null
  private tabsBusy = false
  private stopped = false

  constructor(
    private readonly getSettings: () => Settings,
    /** Talaria's own folder for the copy, for example <userData>/browsers. */
    private readonly dir: string,
    /** The lists changed: update the Pin Manager and the search bar. */
    private readonly onChange: () => void,
    /** A history file of a browser changed: look at the history again. */
    private readonly onHistoryFiles: () => void
  ) {}

  start(): void {
    this.loadCopy()
    this.scanMarks()
    this.settingsChanged()
  }

  stop(): void {
    this.stopped = true
    this.unwatch()
    for (const t of [this.marksTimer, this.historyTimer, this.tabTimer]) if (t) clearTimeout(t)
    this.marksTimer = this.historyTimer = this.tabTimer = null
  }

  /** The user changed a switch: read, watch and poll again as the switches say. */
  settingsChanged(): void {
    if (this.stopped) return
    this.scanMarks()
    this.applyWatch()
    this.applyTabs()
  }

  allMarks(): MergedMark[] { return this.getSettings().otherBookmarks ? this.marks : [] }
  tree(): MarkFolder { return buildFolderTree(this.allMarks()) }
  liveTabs(): LiveTab[] { return this.getSettings().liveTabs ? this.tabs : [] }
  tabBrowsers(): TabBrowserStatus[] { return this.getSettings().liveTabs ? this.tabStatus : [] }
  /** The browsers whose bookmarks can be read here (for the switches). */
  bookmarkSources(): string[] {
    return configuredSources().filter((s) => profileDirs(s).some((p) => bookmarkFile(s, p))).map((s) => s.name)
  }

  // ---- bookmarks --------------------------------------------------------------------------------------------

  private enabledSources() {
    const s = this.getSettings()
    return s.otherBookmarks ? configuredSources().filter((x) => !s.bookmarksOff.includes(x.name)) : []
  }

  private copyFile(): string { return join(this.dir, 'bookmarks-merged.json') }

  /** Show the copy from last time at once, before the browsers' files are read. */
  private loadCopy(): void {
    if (!this.getSettings().keepCopy || !existsSync(this.copyFile())) return
    try {
      const data = JSON.parse(readFileSync(this.copyFile(), 'utf8')) as { marks?: MergedMark[] }
      if (Array.isArray(data.marks)) this.marks = data.marks.filter((m) => m && typeof m.url === 'string' && Array.isArray(m.folders) && Array.isArray(m.sources))
    } catch { /* a bad copy is ignored; the next read makes a new one */ }
  }

  private scanMarks(): void {
    const sources = this.enabledSources()
    const read = sources.map((source) => ({ source, ...readBrowserMarks(source) }))
    const list: BrowserMark[] = read.flatMap((r) => r.marks)
    // A browser that cannot be read right now (locked, or a file in a new format) must not wipe what we had.
    // A browser that is read and has no bookmarks does empty its part of the list.
    const unreadable = new Set(read.filter((r) => !r.ok && profileDirs(r.source).length > 0).map((r) => r.source.name))
    const keptAsMarks: BrowserMark[] = this.marks.flatMap((m) =>
      m.sources.filter((n) => unreadable.has(n)).flatMap((source) => m.folders.map((folder) => ({ url: m.url, title: m.title, folder, source, addedAt: m.addedAt }))))
    const next = this.getSettings().otherBookmarks ? mergeMarks([...list, ...keptAsMarks]) : []
    const same = JSON.stringify(next) === JSON.stringify(this.marks)
    this.marks = next
    this.saveCopy()
    if (!same) this.onChange()
  }

  private saveCopy(): void {
    const s = this.getSettings()
    try {
      if (!s.keepCopy || !s.otherBookmarks) { rmSync(this.copyFile(), { force: true }); return }
      mkdirSync(this.dir, { recursive: true })
      const tmp = `${this.copyFile()}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, savedAt: Date.now(), marks: this.marks }))
      renameSync(tmp, this.copyFile()) // a whole file or nothing
    } catch { /* the copy is a convenience; a failure must never break the app */ }
  }

  // ---- watching the browsers' files -------------------------------------------------------------------------

  private unwatch(): void {
    for (const w of this.watchers) { try { w.close() } catch { /* already closed */ } }
    this.watchers = []
    this.watchKey = ''
  }

  private applyWatch(): void {
    const s = this.getSettings()
    if (!s.watchBrowsers || isTestMode() && !process.env.INSTANT_TEST_WATCH) { this.unwatch(); return }
    const wanted: Array<{ dir: string; kind: 'chromium' | 'firefox' }> = []
    for (const source of configuredSources()) {
      const bm = s.otherBookmarks && !s.bookmarksOff.includes(source.name)
      const hist = s.showHistory && !s.historyOff.includes(source.name)
      if (!bm && !hist) continue
      for (const profile of profileDirs(source)) wanted.push({ dir: profile, kind: source.kind })
    }
    const key = wanted.map((w) => w.dir).sort().join('|')
    if (key === this.watchKey) return
    this.unwatch()
    this.watchKey = key
    for (const w of wanted) {
      try {
        const watcher = watch(w.dir, { persistent: false }, (_event, name) => {
          const file = name ?? ''
          if (w.kind === 'chromium') {
            if (file === 'Bookmarks') this.soon('marks', BOOKMARK_QUIET_MS)
            else if (file === 'History' || file === 'History-journal') this.soon('history', HISTORY_QUIET_MS)
          } else if (file.startsWith('places.sqlite')) {
            this.soon('marks', BOOKMARK_QUIET_MS * 2)
            this.soon('history', HISTORY_QUIET_MS)
          }
        })
        watcher.on('error', () => { /* the folder went away: the next settings change watches again */ })
        this.watchers.push(watcher)
      } catch { /* cannot watch this folder: the regular refresh still works */ }
    }
  }

  /** Run the update once the files have been quiet for a while. */
  private soon(what: 'marks' | 'history', ms: number): void {
    if (this.stopped) return
    if (what === 'marks') {
      if (this.marksTimer) clearTimeout(this.marksTimer)
      this.marksTimer = setTimeout(() => { this.marksTimer = null; this.scanMarks() }, ms)
    } else {
      if (this.historyTimer) clearTimeout(this.historyTimer)
      this.historyTimer = setTimeout(() => { this.historyTimer = null; this.onHistoryFiles() }, ms)
    }
  }

  // ---- open tabs --------------------------------------------------------------------------------------------

  private seenFile(): string { return join(this.dir, 'tabs-seen.json') }

  private applyTabs(): void {
    if (this.tabTimer) { clearTimeout(this.tabTimer); this.tabTimer = null }
    const s = this.getSettings()
    if (!s.liveTabs || (process.platform !== 'darwin' && !isTestMode())) {
      if (this.tabs.length || this.tabStatus.length) { this.tabs = []; this.tabStatus = []; this.onChange() }
      return
    }
    if (Object.keys(this.seen).length === 0 && existsSync(this.seenFile())) {
      try { this.seen = JSON.parse(readFileSync(this.seenFile(), 'utf8')) as Record<string, number> } catch { this.seen = {} }
    }
    void this.pollTabs()
  }

  private async ask(b: TabBrowser): Promise<TabAnswer> {
    if (isTestMode()) {
      const fake = JSON.parse(process.env.INSTANT_TEST_TABS ?? '{}') as Record<string, string>
      return b.name in fake ? { state: 'ok', text: fake[b.name] as string } : { state: 'not-running' }
    }
    // Ask only a browser that is already running. AppleScript would start a closed browser.
    try { await run('pgrep', ['-x', b.process]) } catch { return { state: 'not-running' } }
    try {
      const { stdout } = await run('osascript', ['-e', tabScript(b)], { timeout: 6000, maxBuffer: 4_000_000 })
      return { state: 'ok', text: stdout }
    } catch (error) {
      const message = String((error as { stderr?: string; message?: string }).stderr ?? (error as Error).message ?? '')
      return { state: isPermissionError(message) ? 'denied' : 'error' }
    }
  }

  private async pollTabs(): Promise<void> {
    if (this.stopped || this.tabsBusy) return
    this.tabsBusy = true
    try {
      const s = this.getSettings()
      if (!s.liveTabs) return
      const asked: Array<{ browser: TabBrowser; tabs: RawTab[] | null }> = []
      const status: TabBrowserStatus[] = []
      for (const b of TAB_BROWSERS) {
        if (s.liveTabsOff.includes(b.name)) continue
        const answer = await this.ask(b)
        status.push({ name: b.name, state: answer.state })
        asked.push({ browser: b, tabs: answer.state === 'ok' ? parseTabOutput(answer.text) : answer.state === 'not-running' ? [] : null })
      }
      const stamped = stampTabs(this.seen, asked, Date.now())
      const changed = JSON.stringify(stamped.tabs) !== JSON.stringify(this.tabs) || JSON.stringify(status) !== JSON.stringify(this.tabStatus)
      this.seen = stamped.seen
      this.tabs = stamped.tabs
      this.tabStatus = status
      try { mkdirSync(this.dir, { recursive: true }); writeFileSync(this.seenFile(), JSON.stringify(this.seen)) } catch { /* only a convenience */ }
      if (changed) this.onChange()
    } finally {
      this.tabsBusy = false
      if (!this.stopped && this.getSettings().liveTabs) {
        const every = isTestMode() && process.env.INSTANT_TEST_TABS_MS ? Number(process.env.INSTANT_TEST_TABS_MS) : TABS_EVERY_MS
        this.tabTimer = setTimeout(() => { this.tabTimer = null; void this.pollTabs() }, every)
        this.tabTimer.unref?.()
      }
    }
  }
}
