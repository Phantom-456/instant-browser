import { clipboard, Menu, type BaseWindow, type WebContents } from 'electron'
import { pageMenuItems, type PageMenuAction } from '../shared/pageMenu'

export interface PageMenuDeps {
  /** Open a link in the main browser. */
  onSend: (url: string) => void
  /** The main browser's name, if known, for "Open link in …". */
  browserName: () => string | null
  /** Where a search goes, with %s for the words. */
  searchTemplate: () => string
  /** The window and where the page sits in it, so the menu opens at the click (and at the caret for Shift+F10). */
  placement: () => { window: BaseWindow; x: number; y: number }
}

/**
 * The right-click menu of a web page: links, images, text fields and selected text, or Back,
 * Forward and Reload on the page itself. Electron shows no menu unless the app builds one.
 * On Windows 11 the system draws it as a rounded, themed menu.
 */
export function attachPageMenu(wc: WebContents, deps: PageMenuDeps): void {
  wc.on('context-menu', (_event, p) => {
    const items = pageMenuItems({
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      linkURL: p.linkURL,
      srcURL: p.srcURL,
      mediaType: p.mediaType,
      selectionText: p.selectionText,
      isEditable: p.isEditable,
      editFlags: p.editFlags,
      browserName: deps.browserName()
    })
    const run: Record<PageMenuAction, () => void> = {
      back: () => wc.navigationHistory.goBack(),
      forward: () => wc.navigationHistory.goForward(),
      reload: () => wc.reload(),
      'open-link-in-browser': () => deps.onSend(p.linkURL),
      'copy-link': () => clipboard.writeText(p.linkURL),
      'copy-image': () => wc.copyImageAt(p.x, p.y),
      'copy-image-address': () => clipboard.writeText(p.srcURL),
      undo: () => wc.undo(),
      redo: () => wc.redo(),
      cut: () => wc.cut(),
      copy: () => wc.copy(),
      paste: () => wc.paste(),
      'select-all': () => wc.selectAll(),
      'search-selection': () => void wc.loadURL(deps.searchTemplate().replace('%s', encodeURIComponent(p.selectionText.trim()))).catch(() => {})
    }
    Menu.buildFromTemplate(
      items.map((i) => (i === 'separator' ? { type: 'separator' as const } : { label: i.label, enabled: i.enabled, click: run[i.action] }))
    ).popup((() => {
      const at = deps.placement()
      return { window: at.window, x: Math.round(at.x + p.x), y: Math.round(at.y + p.y) }
    })())
  })
}
