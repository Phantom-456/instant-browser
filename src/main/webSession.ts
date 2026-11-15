import { BaseWindow, WebContentsView, app, dialog, session, type Session, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { httpsUpgrade } from '../shared/httpsFirst'
import { PROMPT_PERMISSIONS, findDecision, originOf, permissionLabel } from '../shared/permissions'
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

/** A file path in `folder` that does not exist yet: name.pdf, name (1).pdf, name (2).pdf ... */
function freePath(folder: string, filename: string): string {
  const ext = extname(filename)
  const stem = filename.slice(0, filename.length - ext.length)
  let path = join(folder, filename)
  for (let n = 1; existsSync(path); n++) path = join(folder, `${stem} (${n})${ext}`)
  return path
}

export function initWebSession(deps: { settings: SettingsFile; permissions: PermissionFile }): Session {
  const { settings, permissions } = deps
  const ses = session.fromPartition('persist:instant')

  // Permission prompt. Anything not in PROMPT_PERMISSIONS is denied without asking.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = originOf(details.requestingUrl || wc.getURL())
    if (!origin || !PROMPT_PERMISSIONS.includes(permission)) return callback(false)
    const saved = findDecision(permissions.list(), origin, permission)
    if (saved) return callback(saved === 'allow')
    const options = {
      type: 'question' as const,
      message: `${origin} wants to ${permissionLabel(permission)}.`,
      buttons: ['Deny', 'Allow'],
      defaultId: 0,
      cancelId: 0,
      checkboxLabel: 'Remember for this site'
    }
    const parent = windowOf(wc)
    const asked = parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
    void asked.then(({ response, checkboxChecked }) => {
      const decision = response === 1 ? 'allow' : 'deny'
      if (checkboxChecked) permissions.save({ origin, permission, decision })
      callback(decision === 'allow')
    })
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    const origin = originOf(requestingOrigin)
    return !!origin && findDecision(permissions.list(), origin, permission) === 'allow'
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
  ses.on('will-download', (_event, item) => {
    const s = settings.get()
    // With no save path set, Electron shows the normal "save as" dialog.
    if (!s.askDownloadLocation) item.setSavePath(freePath(s.downloadFolder ?? app.getPath('downloads'), item.getFilename()))
  })

  cached = ses
  return ses
}
