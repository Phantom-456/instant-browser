// Windows: which keys are held and which app is in front, for the link router.
// A small PowerShell helper answers one line per question: "<mask> <process name>". It is started once and kept,
// so a link does not wait for PowerShell to start (about a second) each time.
// The mask uses the Mac bits that the link router already reads: Shift, Control, Alt (Option) and the Windows key (Command).

export const WIN_KEY_BITS = { shift: 1 << 17, control: 1 << 18, alt: 1 << 19, win: 1 << 20 } as const

/** The PowerShell script. Each line read from stdin gets one answer line on stdout. */
export const WIN_KEY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -Namespace IB -Name K -MemberDefinition @'",
  '[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);',
  '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);',
  "'@",
  'function Down($k) { ([int][IB.K]::GetAsyncKeyState($k) -band 0x8000) -ne 0 }',
  "[Console]::Out.WriteLine('ready')",
  'while ($null -ne ($line = [Console]::In.ReadLine())) {',
  '  $m = 0',
  `  if (Down 0x10) { $m += ${WIN_KEY_BITS.shift} }`,
  `  if (Down 0x11) { $m += ${WIN_KEY_BITS.control} }`,
  `  if (Down 0x12) { $m += ${WIN_KEY_BITS.alt} }`,
  `  if ((Down 0x5B) -or (Down 0x5C)) { $m += ${WIN_KEY_BITS.win} }`,
  '  $p = [uint32]0',
  '  [void][IB.K]::GetWindowThreadProcessId([IB.K]::GetForegroundWindow(), [ref]$p)',
  "  $n = ''",
  '  try { $n = (Get-Process -Id $p).ProcessName } catch { }',
  '  [Console]::Out.WriteLine("$m $n")',
  '}'
].join('\n')

/** The arguments for powershell.exe. The script goes base64 encoded, so nothing in it needs quoting. */
export function winKeyHelperArgs(): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_KEY_SCRIPT, 'utf16le').toString('base64')]
}

/** Reads one answer line. The front app is the process name in lower case, without ".exe", or null. */
export function parseWinKeyLine(line: string): { mask: number | null; frontApp: string | null } {
  const match = /^(\d+)(?: (.*))?$/.exec(line.trim())
  if (!match) return { mask: null, frontApp: null }
  const mask = Number(match[1])
  const all = Object.values(WIN_KEY_BITS).reduce((a, b) => a | b, 0)
  const name = (match[2] ?? '').trim().toLowerCase().replace(/\.exe$/, '')
  return { mask: Number.isSafeInteger(mask) && (mask & ~all) === 0 ? mask : null, frontApp: name || null }
}
