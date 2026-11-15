import { expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

test('the download page and the update setup point at the same GitHub repository', () => {
  const config = read('site/config.js')
  const owner = /owner:\s*'([^']+)'/.exec(config)?.[1]
  const repo = /repo:\s*'([^']+)'/.exec(config)?.[1]
  const builder = read('electron-builder.yml')
  expect(builder).toContain(`owner: ${owner}`)
  expect(builder).toContain(`repo: ${repo}`)
  const pkg = JSON.parse(read('package.json')) as { repository: { url: string }; homepage: string }
  expect(pkg.repository.url).toContain(`${owner}/${repo}`)
  expect(pkg.homepage.toLowerCase()).toContain(`${owner}.github.io/${repo}`.toLowerCase())
})

test('the download buttons find the files by the names electron-builder gives them', () => {
  const script = read('site/main.js')
  // artifactName: Instant-Browser-${version}-mac-${arch}.${ext}  and  ...-win-${arch}.${ext}  (each package has its own file)
  expect(read('electron-builder.mac.yml')).toMatch(/Instant-Browser-\$\{version\}-mac-\$\{arch\}\.\$\{ext\}/)
  expect(read('electron-builder.win.yml')).toMatch(/Instant-Browser-\$\{version\}-win-\$\{arch\}\.\$\{ext\}/)
  expect(script).toContain('mac-arm64\\.dmg')
  expect(script).toContain('mac-x64\\.dmg')
  expect(script).toContain('win-x64\\.exe')
})

test('every file the page uses exists, and the text has no long dashes', () => {
  const html = read('site/index.html')
  const used = [...html.matchAll(/(?:src|href|srcset)="(assets\/[^"]+)"/g)].map((m) => m[1]!)
  expect(used.length).toBeGreaterThan(8)
  for (const file of used) expect(existsSync(`site/${file}`), file).toBe(true)
  for (const file of ['site/index.html', 'site/styles.css', 'site/main.js']) expect(read(file)).not.toMatch(/[—–]/)
})

test('the Mac and Windows packages have their own checks and releases', () => {
  const mac = read('.github/workflows/release-mac.yml')
  const win = read('.github/workflows/release-windows.yml')
  expect(mac).toContain("tags: ['v*']")
  expect(mac).toContain('macos-latest')
  expect(mac).toContain('--config electron-builder.mac.yml')
  expect(mac).toContain('--publish always')
  expect(mac).not.toContain('windows-latest') // a Windows problem must not touch the Mac release
  expect(win).toContain("tags: ['win-v*']")
  expect(win).toContain('windows-latest')
  expect(win).toContain('--config electron-builder.win.yml')
  expect(win).not.toContain('macos-latest')
  // Windows releases are pre-releases with their own tag prefix, so the Mac updater and "latest" never see them.
  const winConfig = read('electron-builder.win.yml')
  expect(winConfig).toContain('releaseType: prerelease')
  expect(winConfig).toContain('tagNamePrefix: win-v')
  // The two checks are separate files too.
  expect(read('.github/workflows/check-mac.yml')).toContain('macos-latest')
  expect(read('.github/workflows/check-windows.yml')).toContain('windows-latest')
  expect(read('.github/workflows/check-windows.yml')).not.toContain('macos-latest')
  // Apple secrets are read from GitHub secrets, never written in the file.
  expect(mac).toContain('secrets.APPLE_APP_SPECIFIC_PASSWORD')
  expect(mac).not.toMatch(/APPLE_APP_SPECIFIC_PASSWORD:\s*['"]?[a-z]{4}-[a-z]{4}-/)
})

test('each package has its own README, and the root README points to both', () => {
  expect(existsSync('packages/mac/README.md')).toBe(true)
  expect(existsSync('packages/windows/README.md')).toBe(true)
  const root = read('README.md')
  expect(root).toContain('packages/mac/README.md')
  expect(root).toContain('packages/windows/README.md')
})
