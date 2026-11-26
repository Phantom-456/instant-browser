/** The right-click menu of a web page in a small window. Pure, so it can be tested without Electron. */

export type PageMenuAction =
  | 'back' | 'forward' | 'reload'
  | 'open-link-in-browser' | 'copy-link'
  | 'copy-image' | 'copy-image-address'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all'
  | 'search-selection'

export type PageMenuItem = { action: PageMenuAction; label: string; enabled: boolean } | 'separator'

/** The parts of Electron's context-menu params this menu needs. */
export interface PageMenuContext {
  canGoBack: boolean
  canGoForward: boolean
  linkURL: string
  srcURL: string
  mediaType: string
  selectionText: string
  isEditable: boolean
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
  /** The main browser's name, for "Open link in Chrome". */
  browserName: string | null
}

const isWebLink = (url: string): boolean => /^https?:/i.test(url)

/** Short text of the selection for "Search for “…”". */
export function selectionLabel(text: string, max = 24): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Groups (link, image, editing or selection, navigation), with separators between them and nothing empty. */
export function pageMenuItems(c: PageMenuContext): PageMenuItem[] {
  const groups: PageMenuItem[][] = []
  if (c.linkURL && isWebLink(c.linkURL)) {
    groups.push([
      { action: 'open-link-in-browser', label: c.browserName ? `Open link in ${c.browserName}` : 'Open link in browser', enabled: true },
      { action: 'copy-link', label: 'Copy link', enabled: true }
    ])
  }
  if (c.mediaType === 'image' && c.srcURL) {
    groups.push([
      { action: 'copy-image', label: 'Copy image', enabled: true },
      { action: 'copy-image-address', label: 'Copy image link', enabled: true }
    ])
  }
  const selected = selectionLabel(c.selectionText)
  if (c.isEditable) {
    const f = c.editFlags
    groups.push([
      { action: 'undo', label: 'Undo', enabled: f.canUndo },
      { action: 'redo', label: 'Redo', enabled: f.canRedo }
    ], [
      { action: 'cut', label: 'Cut', enabled: f.canCut },
      { action: 'copy', label: 'Copy', enabled: f.canCopy },
      { action: 'paste', label: 'Paste', enabled: f.canPaste },
      { action: 'select-all', label: 'Select all', enabled: f.canSelectAll }
    ])
  } else if (selected) {
    groups.push([
      { action: 'copy', label: 'Copy', enabled: true },
      { action: 'search-selection', label: `Search for “${selected}”`, enabled: true }
    ])
  }
  // Back, Forward and Reload only on the page itself, as browsers do, not on a link, image or text.
  if (!groups.length) {
    groups.push([
      { action: 'back', label: 'Back', enabled: c.canGoBack },
      { action: 'forward', label: 'Forward', enabled: c.canGoForward },
      { action: 'reload', label: 'Reload', enabled: true }
    ], [{ action: 'select-all', label: 'Select all', enabled: true }])
  }
  return groups.flatMap((g, i) => (i ? ['separator' as const, ...g] : g))
}
