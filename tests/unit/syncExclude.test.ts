import { describe, expect, it } from 'vitest'
import { isExcludedHost } from '../../src/main/sync/syncManager'
import { mergeSettings } from '../../src/shared/settings'

describe('sites left out of history sync', () => {
  it('matches the site and its subdomains, not look-alikes', () => {
    const list = ['bank.example.com', 'secret.org']
    expect(isExcludedHost('bank.example.com', list)).toBe(true)
    expect(isExcludedHost('www.bank.example.com', list)).toBe(true)
    expect(isExcludedHost('login.secret.org', list)).toBe(true)
    expect(isExcludedHost('example.com', list)).toBe(false)
    expect(isExcludedHost('notsecret.org', list)).toBe(false)
  })
  it('the setting is cleaned when it is read', () => {
    const s = mergeSettings({ syncHistoryExcluded: [' WWW.Bank.com ', 'bank.com', 5, 'bad host!'] })
    expect(s.syncHistoryExcluded).toEqual(['bank.com'])
  })
})
