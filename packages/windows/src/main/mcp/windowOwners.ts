/**
 * Which agent opened which window, kept in memory (lost when Talaria restarts, like the windows themselves).
 * Shared by the window tools (who may close) and list_windows (who opened what).
 * A window the person opened has no owner here, so no agent can close it.
 */
export class WindowOwners {
  private readonly byAgent = new Map<string, Set<number>>()

  /** Record that an agent opened a window. */
  add(agentId: string, windowId: number): void {
    const set = this.byAgent.get(agentId) ?? new Set<number>()
    set.add(windowId)
    this.byAgent.set(agentId, set)
  }

  /** True when this agent opened this window. */
  owns(agentId: string, windowId: number): boolean {
    return this.byAgent.get(agentId)?.has(windowId) ?? false
  }

  /** True when some agent opened it. Never says which. */
  hasOwner(windowId: number): boolean {
    for (const set of this.byAgent.values()) if (set.has(windowId)) return true
    return false
  }

  /** Forget a window (it was closed). */
  remove(windowId: number): void {
    for (const set of this.byAgent.values()) set.delete(windowId)
  }

  /** Forget every window that is no longer open. */
  prune(openIds: Iterable<number>): void {
    const open = new Set(openIds)
    for (const set of this.byAgent.values()) for (const id of [...set]) if (!open.has(id)) set.delete(id)
  }
}
