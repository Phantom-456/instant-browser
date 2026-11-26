import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Windows: when another app already holds the default hotkey, the app picks a free fallback, saves it and says so.
// The 2026-11-15 run on a Windows 11 PC started with no working hotkey because of this.

let holder: ElectronApplication | undefined
let app: ElectronApplication | undefined

test.afterEach(async () => {
  await app?.close().catch(() => {})
  await holder?.close().catch(() => {})
  app = holder = undefined
})

async function launch(settings: object) {
  const userData = mkdtempSync(join(tmpdir(), 'ib-hotkey-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
  const logs: string[] = []
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, INSTANT_TEST: '1', INSTANT_TEST_DEFAULT: '0' } as Record<string, string>
  })
  app.process().stdout?.on('data', (d) => logs.push(String(d)))
  await app.firstWindow()
  return { userData, logs, a: app }
}

/** Start a second Electron process (a stand-in for another app) that registers `key`. Returns whether it got it. */
async function hold(key: string): Promise<boolean> {
  holder = await electron.launch({ args: [join(__dirname, 'fixtures', 'holdHotkey.cjs')] })
  return holder.evaluate(({ globalShortcut }, k) => globalShortcut.register(k, () => {}), key)
}

const saved = (userData: string) => (JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as { hotkey?: string }).hotkey

test('default hotkey taken by another app: a fallback is used, saved and registered', async () => {
  test.skip(process.platform !== 'win32', 'the fallback keys are a Windows feature')
  await hold('Control+Alt+B') // held by the stand-in, or already by a real app on this PC: either way taken

  const { a, userData, logs } = await launch({})
  await expect.poll(() => logs.join(''), { timeout: 10_000 }).toMatch(/\[instant\] hotkey /)
  const active = saved(userData)
  expect(active).toBeTruthy()
  expect(active).not.toBe('Control+Alt+B')
  expect(await a.evaluate(({ globalShortcut }, k) => globalShortcut.isRegistered(k), active!)).toBe(true)
  expect(logs.join('')).toContain('tried Control+Alt+B')
})

test('a PC with the old default (Control+Alt+Space) saved moves to Control+Alt+B', async () => {
  test.skip(process.platform !== 'win32', 'the Windows default')
  const { a, userData, logs } = await launch({ hotkey: 'Control+Alt+Space' })
  await expect.poll(() => logs.join(''), { timeout: 10_000 }).toMatch(/\[instant\] hotkey /)
  const active = saved(userData)
  expect(active).not.toBe('Control+Alt+Space')
  expect(await a.evaluate(({ globalShortcut }, k) => globalShortcut.isRegistered(k), active!)).toBe(true)
  expect(await a.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+Space'))).toBe(false)
})

test('a hotkey the user chose is kept even when it cannot be registered', async () => {
  test.skip(process.platform !== 'win32', 'the fallback keys are a Windows feature')
  expect(await hold('Control+Alt+K')).toBe(true)

  const { userData, logs } = await launch({ hotkey: 'Control+Alt+K' })
  await expect.poll(() => logs.join(''), { timeout: 10_000 }).toContain('[instant] hotkey none (tried Control+Alt+K)')
  expect(saved(userData)).toBe('Control+Alt+K')
})

test('a hotkey with the Windows key is refused instead of taking the plain key from every app', async () => {
  test.skip(process.platform !== 'win32', 'Electron drops the Windows key only on Windows')
  const { a, logs } = await launch({ hotkey: 'Super+Shift+F9' })
  await expect.poll(() => logs.join(''), { timeout: 10_000 }).toContain('[instant] hotkey none (tried Super+Shift+F9)')
  // Shift+F9 on its own must still belong to the other apps.
  expect(await a.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Shift+F9'))).toBe(false)
})

/** Press Control+Alt+B with real key events (keybd_event), holding B for `holdMs` with key repeats every 33 ms. */
function pressControlAltB(holdMs: number): Promise<void> {
  const script = `
Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'
$z = [UIntPtr]::Zero
[W.K]::keybd_event(0x11, 0, 0, $z); [W.K]::keybd_event(0x12, 0, 0, $z)
[W.K]::keybd_event(0x42, 0, 0, $z)
if (${holdMs} -gt 0) {
  Start-Sleep -Milliseconds 520  # the Windows repeat delay (setting 1)
  $end = (Get-Date).AddMilliseconds(${holdMs} - 520)
  while ((Get-Date) -lt $end) { [W.K]::keybd_event(0x42, 0, 0, $z); Start-Sleep -Milliseconds 33 }
}
[W.K]::keybd_event(0x42, 0, 2, $z); [W.K]::keybd_event(0x12, 0, 2, $z); [W.K]::keybd_event(0x11, 0, 2, $z)
`
  return new Promise((resolve, reject) =>
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20_000 }, (error) => (error ? reject(error) : resolve()))
  )
}

test('holding the hotkey opens the bar once; a later press closes it', async () => {
  test.skip(process.platform !== 'win32', 'Windows key repeat')
  const { a, logs } = await launch({})
  await expect.poll(() => logs.join(''), { timeout: 10_000 }).toContain('[instant] hotkey Control+Alt+B')
  const barVisible = () => a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('/search/') && w.isVisible()))
  const count = (word: string) => (logs.join('').match(new RegExp(`\\[instant\\] hotkey press ${word}`, 'g')) ?? []).length

  await pressControlAltB(1500) // held for one and a half seconds
  await expect.poll(() => count('used'), { timeout: 5000 }).toBe(1)
  await new Promise((r) => setTimeout(r, 300))
  const ignored = count('ignored')
  console.log(`key repeats seen while held: ${ignored}`) // evidence that Windows repeats a held global key
  test.info().annotations.push({ type: 'key repeats seen while held', description: String(ignored) })
  expect(count('used')).toBe(1)
  expect(await barVisible()).toBe(true)

  await new Promise((r) => setTimeout(r, 1200)) // let go, wait, press again
  await pressControlAltB(0)
  await expect.poll(() => count('used'), { timeout: 5000 }).toBe(2)
  await expect.poll(barVisible).toBe(false)
})
