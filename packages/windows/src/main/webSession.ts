import { BaseWindow, WebContentsView, app, dialog, session, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import { DownloadPaths } from './downloadPath'
import { downloadLog } from './downloadLog'
import { httpsUpgrade } from '../shared/httpsFirst'
import { PROMPT_PERMISSIONS, originOf, permissionKeys, requestLabel, savedDecision } from '../shared/permissions'
import type { PermissionFile } from './permissionFile'
import type { SettingsFile } from './settingsFile'

let cached: Session | null = null
const upgradedHosts = new Set<string>() // hosts we moved from http to https in this run
const httpAllowedHosts = new Set<string>() // hosts the user allowed to load over http in this run

export function getWebSession(): Session {
  if (!cached) throw new Error('initWebSession must be called first')
  return cached
}

/** True when the https page that failed was our own upgrade of an http address. */
export function wasUpgraded(url: string): boolean {
  try {
    return upgradedHosts.has(new URL(url).hostname)
  } catch {
    return false
  }
}

export function allowHttpFor(hostname: string): void {
  httpAllowedHosts.add(hostname)
}

function windowOf(wc: WebContents): BaseWindow | undefined {
  return BaseWindow.getAllWindows().find((win) =>
    win.contentView.children.some((view) => view instanceof WebContentsView && view.webContents === wc)
  )
}

const downloadPaths = new DownloadPaths()

export function initWebSession(deps: { settings: SettingsFile; permissions: PermissionFile }): Session {
  const { settings, permissions } = deps
  const ses = session.fromPartition('persist:instant')
  // The swipe preload: it only watches the trackpad in pages (see preload/page.ts).
  ses.registerPreloadScript({ type: 'frame', filePath: join(__dirname, '../preload/page.js') })

  // Permission prompt. Anything not in PROMPT_PERMISSIONS is denied without asking.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = originOf(details.requestingUrl || wc.getURL())
    if (!origin || !PROMPT_PERMISSIONS.includes(permission)) return callback(false)
    const keys = permissionKeys(permission, 'mediaTypes' in details ? details.mediaTypes : undefined)
    const saved = savedDecision(permissions.list(), origin, keys)
    if (saved) return callback(saved === 'allow')
    const options = {
      type: 'question' as const,
      message: `${origin} wants to ${requestLabel(keys)}.`,
      buttons: ['Deny', 'Allow'],
      defaultId: 0,
      cancelId: 0,
      checkboxLabel: 'Remember for this site'
    }
    const parent = windowOf(wc)
    const asked = parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
    void asked.then(({ response, checkboxChecked }) => {
      const decision = response === 1 ? 'allow' : 'deny'
      if (checkboxChecked) for (const key of keys) permissions.save({ origin, permission: key, decision })
      callback(decision === 'allow')
    })
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const origin = originOf(requestingOrigin)
    const type = details.mediaType === 'audio' || details.mediaType === 'video' ? [details.mediaType] : undefined
    return !!origin && savedDecision(permissions.list(), origin, permissionKeys(permission, type)) === 'allow'
  })

  // HTTPS first: try https for a main page that was asked for over http.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (details, callback) => {
    if (details.resourceType !== 'mainFrame' || !settings.get().httpsFirst) return callback({})
    const host = new URL(details.url).hostname
    const target = httpAllowedHosts.has(host) ? null : httpsUpgrade(details.url)
    if (!target) return callback({})
    upgradedHosts.add(host)
    callback({ redirectURL: target })
  })

  // Global Privacy Control header.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (settings.get().sendGpc) details.requestHeaders['Sec-GPC'] = '1'
    callback({ requestHeaders: details.requestHeaders })
  })

  // Downloads: saved to a folder, never opened by the app.
  ses.on('will-download', (_event, item, contents) => {
    const owner = contents?.id
    if (owner !== undefined) {
      running.set(owner, (running.get(owner) ?? 0) + 1)
      item.once('done', () => running.set(owner, Math.max(0, (running.get(owner) ?? 1) - 1)))
    }
    const s = settings.get()
    // With no save path set, Electron shows the normal "save as" dialog.
    if (!s.askDownloadLocation) {
      const path = downloadPaths.reserve(s.downloadFolder ?? app.getPath('downloads'), item.getFilename())
      item.setSavePath(path)
      item.once('done', () => downloadPaths.release(path)) // by now the file is on disk (or the download failed)
    }
    downloadLog.track(item) // a list for agents to read
  })

  cached = ses
  return ses
}

/** Downloads that are running, for each page (by its WebContents id). Offload waits while one runs. */
const running = new Map<number, number>()
export const hasRunningDownload = (webContentsId: number): boolean => (running.get(webContentsId) ?? 0) > 0
