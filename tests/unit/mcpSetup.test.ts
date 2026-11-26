import { expect, test } from 'vitest'
import { antigravityConfig, claudeCommand, codexConfig, copyText, jsonConfig, mcpUrl } from '../../src/shared/mcp/setup'

const url = mcpUrl(47821)

test('the address', () => {
  expect(url).toBe('http://127.0.0.1:47821/mcp')
})

test('the Claude Code command', () => {
  expect(claudeCommand(url, 'K')).toBe('claude mcp add --transport http talaria http://127.0.0.1:47821/mcp --header "Authorization: Bearer K"')
})

test('the Codex snippet', () => {
  expect(codexConfig(url, 'K')).toBe('[mcp_servers.talaria]\nurl = "http://127.0.0.1:47821/mcp"\nhttp_headers = { Authorization = "Bearer K" }')
})

test('the JSON is valid and pretty printed', () => {
  const text = jsonConfig(url, 'K')
  expect(text).toContain('\n  "mcpServers"')
  expect(JSON.parse(text)).toEqual({ mcpServers: { talaria: { type: 'http', url, headers: { Authorization: 'Bearer K' } } } })
})

test('copyText picks the text', () => {
  expect(copyText('key', url, 'K')).toBe('K')
  expect(copyText('claude', url, 'K')).toBe(claudeCommand(url, 'K'))
  expect(copyText('codex', url, 'K')).toBe(codexConfig(url, 'K'))
  expect(copyText('json', url, 'K')).toBe(jsonConfig(url, 'K'))
})

test('the Antigravity config has serverUrl and headers, and no type', () => {
  const text = antigravityConfig(url, 'K')
  expect(JSON.parse(text)).toEqual({ mcpServers: { talaria: { serverUrl: url, headers: { Authorization: 'Bearer K' } } } })
  expect(text).not.toContain('"type"')
  expect(copyText('antigravity', url, 'K')).toBe(text)
})
