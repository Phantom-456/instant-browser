import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { changelogReminder, changelogSection, checkVersion, compareSemver, parseChangelog } from '../../scripts/check-version.mjs'

const log = (...sections: string[]) => ['# Changelog', '## [Unreleased]', ...sections].join('\n\n')

test('the repository itself is consistent', () => {
  const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
  expect(checkVersion({ pkgVersion, changelog: readFileSync('CHANGELOG.md', 'utf8') })).toEqual([])
})

test('semver order, pre-releases before the release', () => {
  expect(compareSemver('0.3.0', '0.2.1')).toBeGreaterThan(0)
  expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0)
  expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
  expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0)
  expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
  expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
})

test('parses sections and yanked marks', () => {
  expect(parseChangelog(log('## [0.3.1] - 2026-12-01 [YANKED]', '## [0.3.0] - 2026-11-22'))).toEqual([
    { version: '0.3.1', date: '2026-12-01', yanked: true },
    { version: '0.3.0', date: '2026-11-22', yanked: false },
  ])
})

test('a matching version and tag pass', () => {
  expect(checkVersion({ pkgVersion: '0.3.0', changelog: log('## [0.3.0] - 2026-11-22'), tag: 'v0.3.0' })).toEqual([])
})

test('package.json without a changelog section fails', () => {
  expect(checkVersion({ pkgVersion: '0.3.1', changelog: log('## [0.3.0] - 2026-11-22') }).join()).toMatch(/no "## \[0.3.1\]/)
})

test('a tag that does not match fails', () => {
  expect(checkVersion({ pkgVersion: '0.3.0', changelog: log('## [0.3.0] - 2026-11-22'), tag: 'v0.3.1' }).join()).toMatch(/does not match/)
})

test('a yanked version cannot be released again', () => {
  expect(checkVersion({ pkgVersion: '0.3.1', changelog: log('## [0.3.1] - 2026-12-01 [YANKED]', '## [0.3.0] - 2026-11-22') }).join()).toMatch(/YANKED/)
})

test('versions must go down the file and never repeat', () => {
  expect(checkVersion({ pkgVersion: '0.3.0', changelog: log('## [0.3.0] - 2026-11-22', '## [0.3.0] - 2026-11-20') }).join()).toMatch(/out of order/)
  expect(checkVersion({ pkgVersion: '0.2.0', changelog: log('## [0.2.0] - 2026-11-22', '## [0.3.0] - 2026-11-20') }).join()).toMatch(/out of order/)
})

test('package.json must be the newest section', () => {
  expect(checkVersion({ pkgVersion: '0.3.0', changelog: log('## [0.4.0] - 2026-12-01', '## [0.3.0] - 2026-11-22') }).join()).toMatch(/newest/)
})

test('not semver and missing dates fail', () => {
  expect(checkVersion({ pkgVersion: '0.3', changelog: log('## [0.3] - 2026-11-22') }).join()).toMatch(/not semver/)
  expect(checkVersion({ pkgVersion: '0.3.0', changelog: log('## [0.3.0]') }).join()).toMatch(/no date/)
})

test('the section of one version is the release notes', () => {
  const text = log('## [0.4.0] - 2026-12-01\n\n### Added\n- B', '## [0.3.0] - 2026-11-22\n\n### Added\n- A', '[0.4.0]: https://example.com')
  expect(changelogSection(text, '0.4.0')).toBe('### Added\n- B')
  expect(changelogSection(text, '0.3.0')).toBe('### Added\n- A')
  expect(changelogSection(text, '9.9.9')).toBe('')
})

test('a pull request that changes the app without a changelog line gets a reminder', () => {
  expect(changelogReminder(['src/main/updater.ts'])).toMatch(/Unreleased/)
  expect(changelogReminder(['src/main/updater.ts', 'CHANGELOG.md'])).toBe('')
  expect(changelogReminder(['README.md', 'tests/unit/x.test.ts', '.github/workflows/check-mac.yml'])).toBe('')
  expect(changelogReminder(['packages/windows/src/main/index.ts'])).toBe('')
  expect(changelogReminder(['electron-builder.mac.yml'])).toMatch(/electron-builder\.mac\.yml/)
})
