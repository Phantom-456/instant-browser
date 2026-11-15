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
  const builder = read('electron-builder.yml')
  // artifactName: Instant-Browser-${version}-mac-${arch}.${ext}  and  ...-win-${arch}.${ext}
  expect(builder).toMatch(/Instant-Browser-\$\{version\}-mac-\$\{arch\}\.\$\{ext\}/)
  expect(builder).toMatch(/Instant-Browser-\$\{version\}-win-\$\{arch\}\.\$\{ext\}/)
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

test('the workflows exist and the release one builds both systems', () => {
  const release = read('.github/workflows/release.yml')
  expect(release).toContain("tags: ['v*']")
  expect(release).toContain('macos-latest')
  expect(release).toContain('windows-latest')
  expect(release).toContain('--publish always')
  // Apple secrets are read from GitHub secrets, never written in the file.
  expect(release).toContain('secrets.APPLE_APP_SPECIFIC_PASSWORD')
  expect(release).not.toMatch(/APPLE_APP_SPECIFIC_PASSWORD:\s*['"]?[a-z]{4}-[a-z]{4}-/)
})
