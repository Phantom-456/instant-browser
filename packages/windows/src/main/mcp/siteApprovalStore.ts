import { existsSync, readFileSync } from 'node:fs'
import { BrowserWindow, dialog } from 'electron'
import { writeFileAtomic } from '../atomicWrite'
import { isApproved, listApprovals, parseApprovals, recordApproval, removeApproval, serializeApprovals, type SiteApproval } from '../../shared/mcp/siteApprovals'

/** The sites the person let an agent act on. "Always allow" is kept in a file; "Allow once" is not kept. */
export class SiteApprovalStore {
  private list: SiteApproval[] = []
  private queue: Promise<unknown> = Promise.resolve() // one dialog at a time

  constructor(private readonly path: string) {
    try { this.list = existsSync(path) ? parseApprovals(JSON.parse(readFileSync(path, 'utf8'))) : [] } catch { this.list = [] }
  }

  approvals(): SiteApproval[] { return listApprovals(this.list) }

  remove(agentId: string, origin: string): void {
    this.list = removeApproval(this.list, agentId, origin)
    this.save()
  }

  /** True when the agent may act on the site now. Asks the person the first time. */
  ask(agent: { id: string; name: string }, origin: string, page: Electron.WebContents): Promise<boolean> {
    const next = this.queue.then(() => this.decide(agent, origin, page), () => this.decide(agent, origin, page))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async decide(agent: { id: string; name: string }, origin: string, page: Electron.WebContents): Promise<boolean> {
    if (isApproved(this.list, agent.id, origin)) return true
    const parent = page.isDestroyed() ? null : BrowserWindow.fromWebContents(page)
    const options = {
      type: 'question' as const,
      message: `${agent.name} wants to click and type on ${origin}`,
      detail: 'It will not be able to type into password, card or one-time-code fields.',
      buttons: ['Allow once', 'Always allow for this site', 'Don\'t allow'],
      defaultId: 2,
      cancelId: 2
    }
    const { response } = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (response === 1) {
      this.list = recordApproval(this.list, { agentId: agent.id, agentName: agent.name, origin })
      this.save()
    }
    return response === 0 || response === 1
  }

  private save(): void {
    try { writeFileAtomic(this.path, serializeApprovals(this.list), { mode: 0o600 }) } catch { /* the list in memory still works */ }
  }
}
