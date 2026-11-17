import { expect, test } from 'vitest'
import { findDecision, originOf, permissionLabel, withDecision, withoutDecision } from '../../src/shared/permissions'

test('origin is taken from web URLs only', () => {
  expect(originOf('https://meet.google.com/abc?x=1')).toBe('https://meet.google.com')
  expect(originOf('http://localhost:3000/a')).toBe('http://localhost:3000')
  expect(originOf('file:///x')).toBeNull()
  expect(originOf('nonsense')).toBeNull()
})
test('decisions are saved, replaced, found and removed', () => {
  let saved = withDecision([], { origin: 'https://a.com', permission: 'media', decision: 'allow' })
  saved = withDecision(saved, { origin: 'https://a.com', permission: 'media', decision: 'deny' })
  saved = withDecision(saved, { origin: 'https://b.com', permission: 'geolocation', decision: 'allow' })
  expect(saved).toHaveLength(2)
  expect(findDecision(saved, 'https://a.com', 'media')).toBe('deny')
  expect(findDecision(saved, 'https://a.com', 'geolocation')).toBeNull()
  expect(withoutDecision(saved, 'https://a.com', 'media')).toEqual([
    { origin: 'https://b.com', permission: 'geolocation', decision: 'allow' }
  ])
})
test('labels are plain words', () => {
  expect(permissionLabel('media')).toBe('use your camera or microphone')
  expect(permissionLabel('other-thing')).toBe('use "other-thing"')
})
