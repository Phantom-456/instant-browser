import { expect, test } from 'vitest'
import { settingsTools } from '../../src/main/mcp/settingsTools'
import { applySettingsChange } from '../../src/main/applySettings'
import { createMcpHandler, type ActivityEntry } from '../../src/shared/mcp/protocol'
import { capabilities, capabilityOf, checkPatch, SETTING_ACCESS, visibleSettings } from '../../src/shared/mcp/settingsPolicy'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../../src/shared/settings'

function setup(over: Partial<Settings> = {}) {
  let current: Settings = { ...DEFAULT_SETTINGS, ...over }
  const log: ActivityEntry[] = []
  const handler = createMcpHandler({
    name: 't',
    version: '1',
    tools: () => settingsTools({ get: () => current, update: (p) => { current = mergeSettings({ ...current, ...p }) } }),
    allowed: (t) => t.group === 'read' || current.mcpAllowSettings,
    onChange: (e) => log.push(e)
  })
  let n = 0
  const rpc = async (method: string, params: object = {}) =>
    ((await handler.handle({ jsonrpc: '2.0', id: ++n, method, params }, { client: 'x', agentId: 'ag-000000000001' })) as any).result
  const call = (name: string, args: object = {}) => rpc('tools/call', { name, arguments: args })
  return { call, rpc, log, now: () => current }
}

test('every setting has a class', () => {
  for (const key of Object.keys(DEFAULT_SETTINGS)) expect(['safe', 'read', 'hidden'], key).toContain((SETTING_ACCESS as Record<string, string>)[key])
  expect(Object.keys(SETTING_ACCESS).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
})

test('every mcp setting is hidden and never visible', () => {
  const mcpKeys = Object.keys(DEFAULT_SETTINGS).filter((k) => k.startsWith('mcp'))
  expect(mcpKeys.length).toBeGreaterThan(0)
  const seen = Object.keys(visibleSettings(DEFAULT_SETTINGS))
  for (const k of mcpKeys) {
    expect((SETTING_ACCESS as Record<string, string>)[k]).toBe('hidden')
    expect(seen).not.toContain(k)
  }
})

test('privacy, security, input and link settings are never safe', () => {
  for (const k of ['hotkey', 'httpsFirst', 'sendGpc', 'launchAtLogin', 'mainBrowserId', 'askDownloadLocation', 'downloadFolder', 'linkRouter', 'linkRouterKeys', 'terminalLinksSmallWindow', 'diaProfile', 'diaProfiles']) {
    expect((SETTING_ACCESS as Record<string, string>)[k], k).not.toBe('safe')
  }
})

test('get_settings hides mcp keys and lists the changeable ones', async () => {
  const { call } = setup()
  const r = (await call('get_settings')).structuredContent
  expect(r.settings.pinSize).toBe(28)
  expect(r.settings.hotkey).toBe(DEFAULT_SETTINGS.hotkey)
  expect(Object.keys(r.settings).some((k) => k.startsWith('mcp'))).toBe(false)
  expect(r.changeable).toContain('pinSize')
  expect(r.changeable).not.toContain('hotkey')
})

test('set_setting changes a safe setting and logs the old value for undo', async () => {
  const { call, log, now } = setup({ mcpAllowSettings: true })
  const r = await call('set_setting', { key: 'pinSize', value: 31 })
  expect(r.structuredContent).toEqual({ key: 'pinSize', before: 28, after: 31 })
  expect(now().pinSize).toBe(31)
  expect(log).toHaveLength(1)
  expect(log[0]?.undo).toEqual({ key: 'pinSize', value: 28 })
})

test('set_setting with no real change has no undo', async () => {
  const { call, log } = setup({ mcpAllowSettings: true })
  await call('set_setting', { key: 'pinSize', value: 28 })
  expect(log[0]?.undo).toBeUndefined()
})

test('set_setting refuses the hotkey, link router and agent settings', async () => {
  const { call, log, now } = setup({ mcpAllowSettings: true })
  for (const [key, value] of [['hotkey', 'Control+X'], ['linkRouter', false], ['linkRouterKeys', 'control+shift'], ['mainBrowserId', 'x'], ['launchAtLogin', true], ['mcpEnabled', false], ['mcpAllowSettings', false], ['nope', 1]] as const) {
    const r = await call('set_setting', { key, value })
    expect(r.isError, key).toBe(true)
  }
  expect(now().hotkey).toBe(DEFAULT_SETTINGS.hotkey)
  expect(now().linkRouter).toBe(DEFAULT_SETTINGS.linkRouter)
  expect(now().launchAtLogin).toBe(false)
  expect(now().mcpEnabled).toBe(false)
  expect(log.every((e) => !e.ok && !e.undo)).toBe(true)
})

test('set_setting checks the range and the type', async () => {
  const { call, now } = setup({ mcpAllowSettings: true })
  const big = await call('set_setting', { key: 'pinSize', value: 100 })
  expect(big.isError).toBe(true)
  expect(big.content[0].text).toContain('19 to 37')
  expect((await call('set_setting', { key: 'defaultZoom', value: 9 })).isError).toBe(true)
  expect((await call('set_setting', { key: 'alwaysOnTop', value: 'yes' })).isError).toBe(true)
  expect((await call('set_setting', { key: 'windowSize', value: { width: 10, height: 10 } })).isError).toBe(true)
  expect((await call('set_setting', { key: 'searchTemplate', value: 'javascript:%s' })).isError).toBe(true)
  expect((await call('set_setting', { key: 'searchTemplate', value: 'https://example.com/?q=' })).isError).toBe(true)
  expect(now().pinSize).toBe(28)
  expect((await call('set_setting', { key: 'windowSize', value: { width: 500, height: 700 } })).isError).toBeUndefined()
  const search = await call('set_setting', { key: 'searchTemplate', value: 'https://duckduckgo.com/?q=%s' }) // read-only: it would steer every search
  expect(search.isError).toBe(true)
  expect((await call('set_setting', { key: 'historyOff', value: ['Chrome'] })).isError).toBeUndefined()
  expect(now().historyOff).toEqual(['Chrome'])
})

test('the switch off hides set_setting but not get_settings', async () => {
  const { call, rpc } = setup()
  const names = (await rpc('tools/list')).tools.map((t: any) => t.name)
  expect(names).toContain('get_settings')
  expect(names).not.toContain('set_setting')
  const r = await call('set_setting', { key: 'pinSize', value: 31 })
  expect(r.isError).toBe(true)
  expect(r.content[0].text).toContain('switched off')
})

test('checkPatch returns the merged value', () => {
  expect(checkPatch('maxPins', 10)).toEqual({ maxPins: 10 })
  expect(() => checkPatch('maxPins', 1000)).toThrow('4 to 40')
})

test('applySettingsChange runs the same effects for any caller', () => {
  const calls: string[] = []
  const fx = {
    applyHotkey: () => { calls.push('hotkey'); return true },
    setHotkeyOk: () => {},
    refreshWarm: () => calls.push('warm'),
    refreshHistory: () => calls.push('history'),
    applyMcp: () => calls.push('mcp'),
    setLoginItem: () => calls.push('login')
  }
  applySettingsChange(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, warmWindow: false, showHistory: false }, fx)
  expect(calls).toEqual(['warm', 'history'])
  calls.length = 0
  applySettingsChange(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, pinSize: 31 }, fx)
  expect(calls).toEqual([])
})

test('the login item, hotkey and agent server effects run on their own change', () => {
  const calls: string[] = []
  const fx = {
    applyHotkey: (a: string) => { calls.push('hotkey ' + a); return true },
    setHotkeyOk: (ok: boolean) => calls.push('ok ' + ok),
    refreshWarm: () => {}, refreshHistory: () => {},
    applyMcp: () => calls.push('mcp'),
    setLoginItem: (open: boolean) => calls.push('login ' + open)
  }
  applySettingsChange(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, hotkey: 'Alt+Shift+Space', launchAtLogin: true, mcpPort: 50000 }, fx)
  expect(calls).toEqual(['hotkey Alt+Shift+Space', 'ok true', 'mcp', 'login true'])
})

test('the Windows classes are exactly the ones in the docs', () => {
  const by = (c: string) => Object.keys(SETTING_ACCESS).filter((k) => (SETTING_ACCESS as Record<string, string>)[k] === c).sort()
  expect(by('read')).toEqual(['askDownloadLocation', 'diaProfile', 'diaProfiles', 'downloadFolder', 'hotkey', 'httpsFirst', 'launchAtLogin', 'linkRouter', 'linkRouterKeys', 'mainBrowserId', 'searchTemplate', 'sendGpc', 'terminalLinksSmallWindow'])
  expect(by('safe')).toEqual(['alwaysOnTop', 'autoOffloadInactivity', 'autoOffloadMemory', 'autoOffloadMemoryGB', 'autoOffloadMinutes', 'defaultZoom', 'historyOff', 'maxPins', 'memoryAsk', 'pinArmMs', 'pinSize', 'showHistory', 'showSuggestions', 'updateNotice', 'warmWindow', 'windowSize'])
})

test('an agent can make Instant Browser read less of the other browsers, never more', async () => {
  // list_history shows what these settings let the app read, so turning them back on would let an agent read what the
  // person switched off.
  const { call, now } = setup({ mcpAllowSettings: true, showHistory: false, historyOff: ['Chrome'] })
  const on = await call('set_setting', { key: 'showHistory', value: true })
  expect(on.isError).toBe(true)
  expect(on.content[0].text).toContain('switch "showHistory" off but not on')
  const removed = await call('set_setting', { key: 'historyOff', value: [] })
  expect(removed.isError).toBe(true)
  expect(removed.content[0].text).toContain('Chrome')
  expect([now().showHistory, now().historyOff]).toEqual([false, ['Chrome']])

  // Reading less is fine.
  expect((await call('set_setting', { key: 'historyOff', value: ['Chrome', 'Edge'] })).isError).toBeUndefined()
  const fresh = setup({ mcpAllowSettings: true })
  expect((await fresh.call('set_setting', { key: 'showHistory', value: false })).isError).toBeUndefined()
  expect(fresh.now().showHistory).toBe(false)
})

test('capabilities match what allowed() lets through for every group', async () => {
  const groups = ['read', 'folders', 'windows', 'pins', 'pages', 'settings', 'act'] as const
  const keyOf = { folders: 'mcpAllowFolders', windows: 'mcpAllowWindows', pins: 'mcpAllowPins', pages: 'mcpAllowPages', settings: 'mcpAllowSettings', act: 'mcpAllowActions' } as const
  for (const g of groups) {
    for (const on of [true, false]) {
      const s: Settings = g === 'read' ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, [keyOf[g]]: on }
      expect(capabilityOf(g, s), `${g} ${on}`).toBe(g === 'read' ? true : on)
      expect(capabilities(s)[g === 'act' ? 'actions' : g]).toBe(capabilityOf(g, s))
    }
  }
})

test('get_settings returns capabilities, pages, settings and actions off by default, and never the mcp keys', async () => {
  const t = setup()
  const out = JSON.parse((await t.call('get_settings')).content[0].text)
  expect(out.capabilities).toEqual(capabilities(DEFAULT_SETTINGS))
  expect(out.capabilities.read).toBe(true)
  for (const k of ['pages', 'settings', 'actions']) expect(out.capabilities[k], k).toBe(false)
  expect(Object.keys(out.settings).filter((k) => k.startsWith('mcp'))).toEqual([])
  const on = setup({ mcpAllowWindows: false, mcpAllowActions: true })
  const out2 = JSON.parse((await on.call('get_settings')).content[0].text)
  expect(out2.capabilities.windows).toBe(false)
  expect(out2.capabilities.actions).toBe(true)
  expect(out2.capabilities.pins).toBe(DEFAULT_SETTINGS.mcpAllowPins)
})

test('set_setting still refuses every mcpAllow key', async () => {
  const t = setup({ mcpAllowSettings: true })
  for (const k of Object.keys(DEFAULT_SETTINGS).filter((k) => k.startsWith('mcp'))) {
    const r = await t.call('set_setting', { key: k, value: true })
    expect(r.isError, k).toBe(true)
  }
})
