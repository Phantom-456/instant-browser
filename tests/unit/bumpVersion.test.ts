import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { nextVersion, releaseChangelog } from '../../scripts/bump-version.mjs'
import { checkVersion } from '../../scripts/check-version.mjs'

test('next version for each kind of bump', () => {
  expect(nextVersion('0.3.0', 'patch')).toBe('0.3.1')
  expect(nextVersion('0.3.1', 'minor')).toBe('0.4.0')
  expect(nextVersion('0.3.1', 'major')).toBe('1.0.0')
  expect(nextVersion('0.4.0-rc.2', 'minor')).toBe('0.4.0')
  expect(nextVersion('0.4.1-rc.1', 'patch')).toBe('0.4.1')
  expect(nextVersion('0.3.0', 'v0.4.0-rc.1')).toBe('0.4.0-rc.1')
  expect(() => nextVersion('0.3', 'patch')).toThrow(/not semver/)
})

const sample = [
  '# Changelog', '', '## [Unreleased]', '', '### Fixed', '- A bug', '',
  '## [0.3.0] - 2026-11-22', '', '### Added', '- Things', '',
  '[Unreleased]: https://github.com/Phantom-456/instant-browser/compare/v0.3.0...HEAD',
  '[0.3.0]: https://github.com/Phantom-456/instant-browser/compare/c520afc...v0.3.0', ''
].join('\n')

test('Unreleased notes move into a dated section and the links follow', () => {
  const out = releaseChangelog(sample, '0.3.1', '2026-12-01')
  expect(out).toContain('## [Unreleased]\n\n## [0.3.1] - 2026-12-01\n\n### Fixed\n- A bug\n\n## [0.3.0] - 2026-11-22')
  expect(out).toContain('[Unreleased]: https://github.com/Phantom-456/instant-browser/compare/v0.3.1...HEAD')
  expect(out).toContain('[0.3.1]: https://github.com/Phantom-456/instant-browser/compare/v0.3.0...v0.3.1')
  expect(checkVersion({ pkgVersion: '0.3.1', changelog: out })).toEqual([])
})

test('refuses an empty Unreleased section or a version that exists', () => {
  const empty = sample.replace('### Fixed\n- A bug\n', '')
  expect(() => releaseChangelog(empty, '0.3.1', '2026-12-01')).toThrow(/Nothing under/)
  expect(() => releaseChangelog(sample, '0.3.0', '2026-12-01')).toThrow(/already has/)
})

test('works on the real changelog', () => {
  const real = readFileSync('CHANGELOG.md', 'utf8').replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n- Something\n')
  const out = releaseChangelog(real, '0.3.1', '2026-12-01')
  expect(checkVersion({ pkgVersion: '0.3.1', changelog: out })).toEqual([])
})
