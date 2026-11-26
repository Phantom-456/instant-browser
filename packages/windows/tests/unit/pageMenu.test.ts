import { describe, expect, it } from 'vitest'
import { pageMenuItems, selectionLabel, type PageMenuContext } from '../../src/shared/pageMenu'

const base: PageMenuContext = {
  canGoBack: true, canGoForward: false, linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false,
  editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
  browserName: 'Google Chrome'
}
const actions = (c: Partial<PageMenuContext>) => pageMenuItems({ ...base, ...c }).map((i) => (i === 'separator' ? '-' : i.action))

describe('page right-click menu', () => {
  it('on the page: Back, Forward, Reload, then Select all', () => {
    expect(actions({})).toEqual(['back', 'forward', 'reload', '-', 'select-all'])
    const items = pageMenuItems(base)
    expect(items[1]).toMatchObject({ action: 'forward', enabled: false })
  })

  it('on a link: open in the main browser by name, and copy', () => {
    expect(actions({ linkURL: 'https://example.com/a' })).toEqual(['open-link-in-browser', 'copy-link'])
    expect(pageMenuItems({ ...base, linkURL: 'https://example.com/a' })[0]).toMatchObject({ label: 'Open link in Google Chrome' })
    expect(pageMenuItems({ ...base, browserName: null, linkURL: 'https://x.dev' })[0]).toMatchObject({ label: 'Open link in browser' })
  })

  it('a javascript: or mailto: link gets no link items', () => {
    expect(actions({ linkURL: 'javascript:void(0)' })).toEqual(['back', 'forward', 'reload', '-', 'select-all'])
    expect(actions({ linkURL: 'mailto:a@b.c' })).toEqual(['back', 'forward', 'reload', '-', 'select-all'])
  })

  it('on an image inside a link: both groups, with a separator', () => {
    expect(actions({ linkURL: 'https://x.dev', mediaType: 'image', srcURL: 'https://x.dev/a.png' }))
      .toEqual(['open-link-in-browser', 'copy-link', '-', 'copy-image', 'copy-image-address'])
  })

  it('in a text field: undo and the edit commands, enabled by the page', () => {
    expect(actions({ isEditable: true })).toEqual(['undo', 'redo', '-', 'cut', 'copy', 'paste', 'select-all'])
    const paste = pageMenuItems({ ...base, isEditable: true }).find((i) => i !== 'separator' && i.action === 'paste')
    expect(paste).toMatchObject({ enabled: true })
  })

  it('on selected text: Copy and a search for it', () => {
    expect(actions({ selectionText: 'hello world' })).toEqual(['copy', 'search-selection'])
    expect(pageMenuItems({ ...base, selectionText: 'hello world' })[1]).toMatchObject({ label: 'Search for “hello world”' })
  })

  it('shortens a long selection', () => {
    expect(selectionLabel('a  very\nlong selection of text that goes on')).toBe('a very long selection o…')
  })
})
