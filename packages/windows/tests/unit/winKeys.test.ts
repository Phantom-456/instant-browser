import { execFile } from 'node:child_process'
import { expect, test } from 'vitest'
import { MAX_FAILED_STARTS, WinKeyReader } from '../../src/main/winKeyReader'
import { heldKeysFromMask, isTerminalApp } from '../../src/shared/linkRouter'
import { WIN_KEY_BITS, WIN_KEY_SCRIPT, parseWinKeyLine, winKeyHelperArgs } from '../../src/shared/winKeys'

test('the Windows bits are the link router bits: Alt is option, the Windows key is command', () => {
  expect(heldKeysFromMask(WIN_KEY_BITS.control | WIN_KEY_BITS.alt).sort()).toEqual(['control', 'option'])
  expect(heldKeysFromMask(WIN_KEY_BITS.shift)).toEqual(['shift'])
  expect(heldKeysFromMask(WIN_KEY_BITS.win)).toEqual(['command'])
})

test('an answer line gives the mask and the app in front', () => {
  expect(parseWinKeyLine('0 Teams')).toEqual({ mask: 0, frontApp: 'teams' })
  expect(parseWinKeyLine(`${WIN_KEY_BITS.control | WIN_KEY_BITS.alt} WindowsTerminal\r`)).toEqual({ mask: WIN_KEY_BITS.control | WIN_KEY_BITS.alt, frontApp: 'windowsterminal' })
  expect(parseWinKeyLine('0 Code - Insiders')).toEqual({ mask: 0, frontApp: 'code - insiders' })
  expect(parseWinKeyLine('0 ')).toEqual({ mask: 0, frontApp: null }) // no window in front
  expect(parseWinKeyLine('0')).toEqual({ mask: 0, frontApp: null })
})

test('a broken answer means "cannot tell" (the link then opens in a small window)', () => {
  for (const line of ['', 'ready', 'Exception: oops', '-1 x', 'NaN x']) expect(parseWinKeyLine(line).mask).toBeNull()
  expect(parseWinKeyLine('1 x').mask).toBeNull() // a bit the helper never sends
})

test('terminals on Windows are known by their process name', () => {
  for (const name of ['windowsterminal', 'powershell', 'pwsh', 'cmd', 'code']) expect(isTerminalApp(name)).toBe(true)
  for (const name of ['teams', 'ms-teams', 'outlook', 'explorer']) expect(isTerminalApp(name)).toBe(false)
})

test('the script is sent encoded, so it needs no quoting', () => {
  const args = winKeyHelperArgs()
  expect(args.slice(0, -1)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
  expect(Buffer.from(args.at(-1)!, 'base64').toString('utf16le')).toBe(WIN_KEY_SCRIPT)
})

test('a helper that cannot start answers "cannot tell", quickly', async () => {
  const reader = new WinKeyReader('no-such-program-ib')
  const started = Date.now()
  expect(await reader.read(500)).toEqual({ mask: null, frontApp: null })
  expect(Date.now() - started).toBeLessThan(3000)
  reader.stop()
})

test('a helper that keeps failing is given up, so links stop waiting for it', async () => {
  const reader = new WinKeyReader('no-such-program-ib')
  for (let i = 0; i < MAX_FAILED_STARTS; i++) expect(await reader.start()).toBe(false)
  const started = Date.now()
  expect(await reader.read(500)).toEqual({ mask: null, frontApp: null })
  expect(Date.now() - started).toBeLessThan(50) // no new attempt
  reader.stop()
})

// The real helper on Windows: nothing held, then Control+Alt held with synthetic key presses.
const win = process.platform === 'win32'
const ps = (script: string) =>
  new Promise<void>((resolve, reject) =>
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20_000 }, (e) => (e ? reject(e) : resolve()))
  )
const KEYS = "Add-Type -Namespace IBT -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);';"

test.runIf(win)('Windows: the helper reads held keys', { timeout: 60_000 }, async () => {
  const reader = new WinKeyReader()
  try {
    expect(await reader.start()).toBe(true)
    const idle = await reader.read(5000)
    expect(idle.mask).toBe(0)
    const time = Date.now()
    await reader.read(5000)
    expect(Date.now() - time).toBeLessThan(1000) // the helper stays running: an answer is quick
    await ps(`${KEYS} [IBT.K]::keybd_event(0x11,0,0,[UIntPtr]::Zero); [IBT.K]::keybd_event(0x12,0,0,[UIntPtr]::Zero)`)
    try {
      const held = await reader.read(5000)
      expect(held.mask).toBe(WIN_KEY_BITS.control | WIN_KEY_BITS.alt)
    } finally {
      await ps(`${KEYS} [IBT.K]::keybd_event(0x12,0,2,[UIntPtr]::Zero); [IBT.K]::keybd_event(0x11,0,2,[UIntPtr]::Zero)`)
    }
    expect((await reader.read(5000)).mask).toBe(0)
  } finally {
    reader.stop()
  }
})
