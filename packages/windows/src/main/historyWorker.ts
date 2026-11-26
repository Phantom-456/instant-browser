/**
 * Reads the history files of the browsers. It runs in its own process (an Electron utility process),
 * so reading big files can never freeze the windows of the app.
 *
 * It keeps a small cache of the rows it read, so the next start shows old data at once and reads again
 * only the files that changed. The cache is on this computer only.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { setPriority } from 'node:os'
import { buildHistory, capHistory, type History, type RawVisit } from '../shared/history'
import { planScan, settleReads, type CachedFile, type FoundFile } from '../shared/historyCache'
import type { HistorySource } from '../shared/historyPaths'
import { listHistoryFiles, tryReadHistoryFile } from './historyReader'

export interface ScanRequest {
  type: 'scan'
  sources: HistorySource[]
  cachePath: string
  /** What was opened from the search bar (it is not in any browser). */
  own: RawVisit[]
}
export interface ScanResult {
  type: 'result'
  /** "cache": old data, sent first. "fresh": all files are up to date. */
  stage: 'cache' | 'fresh'
  history: History
  stats: { reused: number; read: number; ms: number }
}

const MAX_SEARCHES = 3000
const MAX_PAGES = 6000

function loadCache(path: string): CachedFile[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (c): c is CachedFile => !!c && typeof c.path === 'string' && typeof c.source === 'string' && Array.isArray(c.rows) && typeof c.sig?.size === 'number'
    )
  } catch {
    return []
  }
}

function saveCache(path: string, cache: CachedFile[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, JSON.stringify(cache), { mode: 0o600 }) // only this user can read it
    renameSync(temporary, path)
  } catch {
    // no cache this time: the next start reads everything again
  }
}

const build = (cache: CachedFile[], own: RawVisit[]): History =>
  capHistory(buildHistory([...cache.flatMap((c) => c.rows), ...own]), MAX_SEARCHES, MAX_PAGES, Date.now())

function scan(request: ScanRequest): void {
  const started = Date.now()
  try { setPriority(10) } catch { /* not important */ } // be gentle: other programs come first
  const found: FoundFile[] = []
  const kindOf = new Map<string, HistorySource>()
  for (const source of request.sources) {
    for (const path of listHistoryFiles(source)) {
      try {
        const st = statSync(path)
        found.push({ path, source: source.name, sig: { size: st.size, mtimeMs: st.mtimeMs } })
        kindOf.set(path, source)
      } catch { /* the file vanished */ }
    }
  }
  const cache = loadCache(request.cachePath)
  const plan = planScan(found, cache)
  const send = (stage: ScanResult['stage'], history: History) =>
    process.parentPort.postMessage({ type: 'result', stage, history, stats: { reused: plan.reuse.length, read: plan.read.length, ms: Date.now() - started } } satisfies ScanResult)

  // 1. Old data first, so the search bar is useful at once.
  if (plan.read.length > 0 && plan.reuse.length > 0) send('cache', build(plan.reuse, request.own))

  // 2. Read only what changed.
  const fresh: CachedFile[] = settleReads(plan.read.map((file) => ({ file, rows: tryReadHistoryFile(file.path, kindOf.get(file.path)!) })), cache)
  const all = [...plan.reuse, ...fresh]
  if (plan.read.length > 0) saveCache(request.cachePath, all)
  send('fresh', build(all, request.own))
}

process.parentPort.on('message', (event) => {
  const message = event.data as ScanRequest
  if (message?.type === 'scan') scan(message)
})
