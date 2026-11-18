import { describe, expect, it } from 'vitest'
import { isPermissionError, parseTabOutput, stampTabs, TAB_BROWSERS } from '../../src/shared/liveTabs'

const chrome = TAB_BROWSERS.find((b) => b.name === 'Google Chrome')!
const safari = TAB_BROWSERS.find((b) => b.name === 'Safari')!

describe('live tabs', () => {
  it('reads the AppleScript answer and skips tabs that are not web pages', () => {
    const tabs = parseTabOutput('10\t1\thttps://a.example.com/\tA page\n10\t2\tchrome://settings\tSettings\n\n11\t5\thttp://b.example.com/\tB\twith tab\n')
    expect(tabs.map((t) => t.url)).toEqual(['https://a.example.com/', 'http://b.example.com/'])
    expect(tabs[1]!.title).toBe('B\twith tab')
  })

  it('keeps the first-seen time of a tab that is still open, even after it goes to another address', () => {
    const first = stampTabs({}, [{ browser: chrome, tabs: [{ window: '1', tab: '9', url: 'https://a.example.com/', title: 'A' }] }], 1000)
    expect(first.tabs[0]!.firstSeen).toBe(1000)
    const next = stampTabs(first.seen, [{ browser: chrome, tabs: [{ window: '1', tab: '9', url: 'https://other.example.com/', title: 'O' }, { window: '1', tab: '10', url: 'https://new.example.com/', title: 'N' }] }], 5000)
    expect(next.tabs.map((t) => t.firstSeen)).toEqual([1000, 5000])
  })

  it('forgets closed tabs, but keeps what it knew about a browser it could not ask', () => {
    const start = stampTabs({}, [{ browser: chrome, tabs: [{ window: '1', tab: '9', url: 'https://a.example.com/', title: 'A' }] }, { browser: safari, tabs: [{ window: '2', tab: '1', url: 'https://s.example.com/', title: 'S' }] }], 1000)
    const later = stampTabs(start.seen, [{ browser: chrome, tabs: [] }, { browser: safari, tabs: null }], 9000)
    expect(Object.keys(later.seen).some((k) => k.startsWith('Google Chrome'))).toBe(false) // closed
    expect(Object.keys(later.seen).some((k) => k.startsWith('Safari'))).toBe(true) // not asked: kept
  })

  it('knows a permission error', () => {
    expect(isPermissionError('execution error: Not authorized to send Apple events to Google Chrome. (-1743)')).toBe(true)
    expect(isPermissionError('something else')).toBe(false)
  })
})
