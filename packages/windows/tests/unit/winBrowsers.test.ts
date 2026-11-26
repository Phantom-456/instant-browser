import { describe, expect, it } from 'vitest'
import { isRetiredWindowsBrowser, windowsBrowserName } from '../../src/shared/winBrowsers'

describe('Windows browser names', () => {
  it('leaves out Internet Explorer', () => {
    expect(isRetiredWindowsBrowser('IEXPLORE.EXE')).toBe(true)
    expect(isRetiredWindowsBrowser('Google Chrome')).toBe(false)
  })

  it('uses the name Windows stores for the browser', () => {
    expect(windowsBrowserName('Firefox-308046B0AF4A39CB', 'Firefox')).toBe('Firefox')
    expect(windowsBrowserName('Brave', 'Brave')).toBe('Brave')
  })

  it('cleans up the key when there is no stored name', () => {
    expect(windowsBrowserName('Firefox-308046B0AF4A39CB', null)).toBe('Firefox')
    expect(windowsBrowserName('OPERA.EXE', '')).toBe('OPERA')
    expect(windowsBrowserName('Microsoft Edge', null)).toBe('Microsoft Edge')
  })
})
