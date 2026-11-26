import { expect, test } from 'vitest'
import { actOrigin, isApproved, listApprovals, parseApprovals, recordApproval, removeApproval, serializeApprovals } from '../../src/shared/mcp/siteApprovals'
import { NOT_EDITABLE, TYPE_REFUSED, typeRefusal, underLimit } from '../../src/shared/mcp/actRules'

test('only http and https origins can be acted on', () => {
  expect(actOrigin('https://a.example/x?y=1')).toBe('https://a.example')
  expect(actOrigin('http://a.example:8080/')).toBe('http://a.example:8080')
  for (const u of ['file:///etc/passwd', 'about:blank', 'chrome://x', 'javascript:1', 'nope', '']) expect(actOrigin(u)).toBeNull()
})

test('record, look up, list and remove approvals', () => {
  let list = recordApproval([], { agentId: 'b', agentName: 'Beta', origin: 'https://z.example' })
  list = recordApproval(list, { agentId: 'a', agentName: 'Alpha', origin: 'https://z.example' })
  list = recordApproval(list, { agentId: 'a', agentName: 'Alpha 2', origin: 'https://z.example' })
  expect(list).toHaveLength(2)
  expect(isApproved(list, 'a', 'https://z.example')).toBe(true)
  expect(isApproved(list, 'a', 'https://other.example')).toBe(false)
  expect(listApprovals(list).map((x) => x.agentName)).toEqual(['Alpha 2', 'Beta'])
  list = removeApproval(list, 'a', 'https://z.example')
  expect(isApproved(list, 'a', 'https://z.example')).toBe(false)
  expect(isApproved(list, 'b', 'https://z.example')).toBe(true)
})

test('file shape: round trip, and bad data is dropped', () => {
  const list = [{ agentId: 'a', agentName: 'A', origin: 'https://x.example' }]
  expect(parseApprovals(JSON.parse(serializeApprovals(list)))).toEqual(list)
  for (const bad of [null, 5, 'x', [], {}, { approvals: 'no' }]) expect(parseApprovals(bad)).toEqual([])
  expect(parseApprovals({ approvals: [
    { agentId: 'a', agentName: 'A', origin: 'https://x.example/path' },
    { agentId: 'a', agentName: 'A', origin: 'file:///x' },
    { agentId: 1, agentName: 'A', origin: 'https://y.example' },
    null,
    { agentId: 'c', agentName: 'C', origin: 'https://y.example' }
  ] })).toEqual([{ agentId: 'c', agentName: 'C', origin: 'https://y.example' }])
})

test('typing is refused in password, card and one-time-code fields', () => {
  expect(typeRefusal({ tag: 'INPUT', type: 'password' })).toBe(TYPE_REFUSED)
  expect(typeRefusal({ tag: 'input', type: 'text', autocomplete: 'cc-number' })).toBe(TYPE_REFUSED)
  expect(typeRefusal({ tag: 'input', type: 'text', autocomplete: 'section-x cc-csc' })).toBe(TYPE_REFUSED)
  expect(typeRefusal({ tag: 'input', type: 'text', autocomplete: 'one-time-code' })).toBe(TYPE_REFUSED)
  expect(typeRefusal({ tag: 'input', type: 'text', autocomplete: 'current-password' })).toBe(TYPE_REFUSED)
})

test('typing is allowed in text fields and refused in other elements', () => {
  expect(typeRefusal({ tag: 'INPUT', type: '' })).toBeNull()
  expect(typeRefusal({ tag: 'input', type: 'search', autocomplete: 'off' })).toBeNull()
  expect(typeRefusal({ tag: 'TEXTAREA' })).toBeNull()
  expect(typeRefusal({ tag: 'DIV', editable: true })).toBeNull()
  for (const info of [{ tag: 'DIV' }, { tag: 'BUTTON' }, { tag: 'input', type: 'checkbox' }, { tag: 'select' }, { tag: 'input', type: 'submit' }]) expect(typeRefusal(info)).toBe(NOT_EDITABLE)
})

test('the sliding window allows 60 calls a minute', () => {
  const calls = new Map<string, number[]>()
  for (let i = 0; i < 60; i++) expect(underLimit(calls, 'a', 1000 + i, 60, 60_000)).toBe(true)
  expect(underLimit(calls, 'a', 2000, 60, 60_000)).toBe(false)
  expect(underLimit(calls, 'b', 2000, 60, 60_000)).toBe(true)
  expect(underLimit(calls, 'a', 61_500, 60, 60_000)).toBe(true)
})
