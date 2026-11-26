import { describe, expect, it, test } from 'vitest'
import { findDecision, originOf, permissionKeys, permissionLabel, requestLabel, savedDecision, withDecision, withoutDecision } from '../../src/shared/permissions'

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

describe('camera and microphone are remembered apart (bug hunt 13)', () => {
  const o = 'https://meet.example.com'
  it('allowing the microphone does not allow the camera', () => {
    const saved = permissionKeys('media', ['audio']).map((p) => ({ origin: o, permission: p, decision: 'allow' as const }))
    expect(savedDecision(saved, o, permissionKeys('media', ['audio']))).toBe('allow')
    expect(savedDecision(saved, o, permissionKeys('media', ['video']))).toBeNull() // ask
    expect(savedDecision(saved, o, permissionKeys('media', ['audio', 'video']))).toBeNull()
  })
  it('a denied part denies the request', () => {
    const saved = [{ origin: o, permission: 'media:video', decision: 'deny' as const }, { origin: o, permission: 'media:audio', decision: 'allow' as const }]
    expect(savedDecision(saved, o, permissionKeys('media', ['audio', 'video']))).toBe('deny')
  })
  it('no media type means both, and an old plain "media" entry still counts for both', () => {
    expect(permissionKeys('media')).toEqual(['media:audio', 'media:video'])
    expect(savedDecision([{ origin: o, permission: 'media', decision: 'allow' }], o, permissionKeys('media', ['video']))).toBe('allow')
    expect(permissionKeys('geolocation', ['audio'])).toEqual(['geolocation'])
  })
  it('the prompt names what is asked for', () => {
    expect(requestLabel(permissionKeys('media', ['audio']))).toBe('use your microphone')
    expect(requestLabel(permissionKeys('media', ['video', 'audio']))).toBe('use your camera and microphone')
  })
})
