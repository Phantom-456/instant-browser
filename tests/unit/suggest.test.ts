import { expect, test } from 'vitest'
import { parseSuggestions, suggestEndpoint } from '../../src/shared/suggest'

test('the suggestion address follows the search engine', () => {
  expect(suggestEndpoint('https://www.google.com/search?q=%s', 'define ent')).toBe(
    'https://suggestqueries.google.com/complete/search?client=firefox&q=define%20ent'
  )
  expect(suggestEndpoint('https://duckduckgo.com/?q=%s', 'a&b')).toBe('https://duckduckgo.com/ac/?q=a%26b&type=list')
  expect(suggestEndpoint('https://www.bing.com/search?q=%s', 'x')).toBe('https://api.bing.com/osjson.aspx?query=x')
})
test('other or broken search engines give no suggestions', () => {
  expect(suggestEndpoint('https://search.brave.com/search?q=%s', 'x')).toBeNull()
  expect(suggestEndpoint('https://my-own.example/?q=%s', 'x')).toBeNull()
  expect(suggestEndpoint('not a url', 'x')).toBeNull()
  expect(suggestEndpoint('https://www.google.com/search?q=%s', '   ')).toBeNull()
})
test('the answer list is read, cleaned and limited', () => {
  expect(parseSuggestions(['q', ['one', 'two', '', 3, 'one']])).toEqual(['one', 'two'])
  expect(parseSuggestions(['q', Array.from({ length: 20 }, (_, i) => `s${i}`)])).toHaveLength(7)
  expect(parseSuggestions(null)).toEqual([])
  expect(parseSuggestions({ a: 1 })).toEqual([])
  expect(parseSuggestions(['q'])).toEqual([])
})
