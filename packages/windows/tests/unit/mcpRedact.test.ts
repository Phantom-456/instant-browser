import { expect, test } from 'vitest'
import { blackOutRects, redactSecrets, redactUrl } from '../../src/shared/mcp/redact'

const A = 'abcdefghijklmnopqrstuvwxyz0123456789'

test('well-known key formats are hidden', () => {
  const secrets = [
    `sk-ant-api03-${A}`, `sk-proj-${A}`, `sk-${A}`, `ghp_${A}`, `github_pat_${A}`, `glpat-${A.slice(0, 22)}`,
    'xoxb-1234567890-abcdef', 'AKIAABCDEFGHIJKLMNOP', `AIza${A.slice(0, 35)}`, `sk_live_${A.slice(0, 20)}`, `rk_test_${A.slice(0, 20)}`,
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw.SflKxwRJSMeKKF2QT4fw',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJB\n-----END RSA PRIVATE KEY-----',
    'Bearer abcdefghijklmnopqrstuvwx=='
  ]
  for (const s of secrets) {
    const r = redactSecrets(`before ${s} after`)
    expect(r.text, s).toBe('before [hidden secret] after')
    expect(r.count, s).toBe(1)
  }
})

test('labelled values are hidden and the label stays', () => {
  expect(redactSecrets('API key: 9f8e7d6c5b4a3b2c1d0e')).toEqual({ text: 'API key: [hidden secret]', count: 1 })
  expect(redactSecrets('password = "hunter2hunter2hunter2"').text).toBe('password = "[hidden secret]"')
  expect(redactSecrets('client_secret:abcdefghijkl').text).toBe('client_secret:[hidden secret]')
  expect(redactSecrets('Token: abcdefghijklmnop').count).toBe(1)
  expect(redactSecrets('api_key: sk-ant-api03-' + A).count).toBe(1)
})

test('ordinary text is left alone', () => {
  const texts = [
    'The quick brown fox jumps over the lazy dog. Reset your password on the settings page.',
    'We use a token to sign you in; the secret is kept safe.',
    'Password: short', 'token: abc',
    'Visit https://example.com/docs/getting-started?page=2 for more',
    'Color #ff00aa and #fff, id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 in prose',
    'sk-short', 'ghp_tooshort', 'Bearer token', 'A very-long-hyphenated-word-without-meaning-at-all'
  ]
  for (const t of texts) expect(redactSecrets(t), t).toEqual({ text: t, count: 0 })
  expect(redactSecrets('')).toEqual({ text: '', count: 0 })
})

test('redactUrl hides secret parameters and credentials', () => {
  expect(redactUrl('https://u:p@a.example/x?api_key=abc&q=cats&Token=zzz')).toEqual({
    url: 'https://a.example/x?api_key=[hidden]&q=cats&Token=[hidden]', count: 3
  })
  expect(redactUrl('https://a.example/x?q=1&page=2')).toEqual({ url: 'https://a.example/x?q=1&page=2', count: 0 })
  expect(redactUrl('https://a.example/?code=1&sig=2&session=3&auth=4&key=5&secret=6&password=7&signature=8&access_token=9&apikey=10').count).toBe(10)
  expect(redactUrl('https://a.example/?token=').count).toBe(0)
  expect(redactUrl('not a url ghp_' + A).count).toBe(1)
})

test('blackOutRects paints BGRA black, clamps and scales', () => {
  const w = 10, h = 10
  const buf = Buffer.alloc(w * h * 4, 255)
  const px = (x: number, y: number) => Array.from(buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4))
  const n = blackOutRects(buf, w, h, [{ x: 2, y: 2, width: 2, height: 2 }], 2)
  expect(n).toBe(1)
  expect(px(5, 5)).toEqual([0, 0, 0, 255])
  expect(px(0, 9)).toEqual([255, 255, 255, 255])
  const buf2 = Buffer.alloc(w * h * 4, 255)
  expect(blackOutRects(buf2, w, h, [{ x: -50, y: -50, width: 55, height: 55 }, { x: 100, y: 100, width: 5, height: 5 }, { x: 1, y: 1, width: 0, height: 3 }], 1)).toBe(1)
  expect(buf2[0]).toBe(0)
  expect(buf2[(9 * w + 9) * 4]).toBe(255)
  expect(blackOutRects(Buffer.alloc(4), 10, 10, [{ x: 0, y: 0, width: 1, height: 1 }], 1)).toBe(0)
})
