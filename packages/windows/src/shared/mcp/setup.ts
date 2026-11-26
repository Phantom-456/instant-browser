/** The text a person copies to connect an agent. Pure, so it is easy to test. */

export function mcpUrl(port: number): string { return `http://127.0.0.1:${port}/mcp` }

export function claudeCommand(url: string, key: string): string {
  return `claude mcp add --transport http instant-browser ${url} --header "Authorization: Bearer ${key}"`
}

export function codexConfig(url: string, key: string): string {
  return `[mcp_servers.instant-browser]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${key}" }`
}

export function jsonConfig(url: string, key: string): string {
  return JSON.stringify({ mcpServers: { 'instant-browser': { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)
}

export type McpCopyTarget = 'claude' | 'codex' | 'json' | 'key'

export function copyText(target: McpCopyTarget, url: string, key: string): string {
  switch (target) {
    case 'claude': return claudeCommand(url, key)
    case 'codex': return codexConfig(url, key)
    case 'json': return jsonConfig(url, key)
    case 'key': return key
  }
}
