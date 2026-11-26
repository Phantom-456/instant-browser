import { expect, test } from 'vitest'
import { cleanLinks, fitWidth, trimPageText } from '../../src/shared/mcp/pageText'

test('trimPageText collapses blank runs and trims', () => {
  expect(trimPageText('  a\n\n\n\n\nb  ', 100)).toEqual({ text: 'a\n\nb', truncated: false })
})

test('trimPageText cuts at max and says so', () => {
  expect(trimPageText('abcdef', 4)).toEqual({ text: 'abcd', truncated: true })
  expect(trimPageText('abcd', 4).truncated).toBe(false)
})

test('cleanLinks keeps http and https only, once each', () => {
  const out = cleanLinks([
    { text: 'A', href: 'https://a.example/' },
    { text: 'dup', href: 'https://a.example/' },
    { text: 'js', href: 'javascript:alert(1)' },
    { text: 'file', href: 'file:///etc/passwd' },
    { text: ' B  b ', href: 'http://b.example/' },
    null, { text: 1, href: 5 }
  ])
  expect(out).toEqual([{ text: 'A', href: 'https://a.example/' }, { text: 'B b', href: 'http://b.example/' }])
})

test('cleanLinks cuts text to 200 and the list to 200', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ text: 'x'.repeat(500), href: `https://e.example/${i}` }))
  const out = cleanLinks(many)
  expect(out).toHaveLength(200)
  expect(out[0]!.text).toHaveLength(200)
  expect(cleanLinks('nope')).toEqual([])
})

test('fitWidth keeps the shape and never grows', () => {
  expect(fitWidth(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  expect(fitWidth(3200, 1000, 1600)).toEqual({ width: 1600, height: 500 })
  expect(fitWidth(1601, 1, 1600).height).toBe(1)
})

import { cleanElements as cleanEls, cleanLinks as cleanLks } from '../../src/shared/mcp/pageText'
test('cleanElements keeps numbered elements with short labels, and link indexes', () => {
  const raw = [{ index: 1, tag: 'input', type: 'text', label: '  Search   here ' }, { index: 0, tag: 'a', label: 'x' }, { tag: 'a' }, { index: 2, tag: 'button', label: 'y'.repeat(200), value: 'secret' }]
  const out = cleanEls(raw)
  expect(out).toEqual([{ index: 1, tag: 'input', type: 'text', label: 'Search here' }, { index: 2, tag: 'button', label: 'y'.repeat(80) }])
  expect(cleanEls(Array.from({ length: 300 }, (_, i) => ({ index: i + 1, tag: 'a', label: '' })))).toHaveLength(200)
  expect(cleanLks([{ text: 'A', href: 'https://x.example', index: 4 }])).toEqual([{ text: 'A', href: 'https://x.example', index: 4 }])
})
