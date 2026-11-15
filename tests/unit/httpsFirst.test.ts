import { expect, test } from 'vitest'
import { httpFallback, httpsUpgrade, isLocalHost } from '../../src/shared/httpsFirst'

test('local hosts are found', () => {
  for (const h of ['localhost', 'app.localhost', '127.0.0.1', '10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.9.9', '[::1]', 'printer.local'])
    expect(isLocalHost(h)).toBe(true)
  for (const h of ['example.com', '172.32.0.1', '8.8.8.8']) expect(isLocalHost(h)).toBe(false)
})
test('http is upgraded, except local and https', () => {
  expect(httpsUpgrade('http://example.com/a?b=1')).toBe('https://example.com/a?b=1')
  expect(httpsUpgrade('http://example.com:8080/a')).toBeNull() // a custom port has no known https twin
  expect(httpsUpgrade('http://localhost:3000/')).toBeNull()
  expect(httpsUpgrade('https://example.com/')).toBeNull()
  expect(httpsUpgrade('nonsense')).toBeNull()
})
test('https goes back to http for the fallback', () => {
  expect(httpFallback('https://example.com/a?b=1')).toBe('http://example.com/a?b=1')
  expect(httpFallback('http://example.com/')).toBeNull()
})
