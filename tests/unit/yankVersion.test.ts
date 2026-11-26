import { expect, test } from 'vitest'
import { yankChangelog } from '../../scripts/yank-version.mjs'
import { checkVersion, parseChangelog } from '../../scripts/check-version.mjs'

const sample = [
  '# Changelog', '', '## [Unreleased]', '',
  '## [0.3.1] - 2026-12-01', '', '### Fixed', '- A bug', '',
  '## [0.3.0] - 2026-11-22', '', '### Added', '- Things', ''
].join('\n')

test('marks the heading [YANKED] and keeps the rest', () => {
  const out = yankChangelog(sample, '0.3.1')
  expect(out).toContain('## [0.3.1] - 2026-12-01 [YANKED]\n\n### Fixed')
  expect(out).toContain('## [0.3.0] - 2026-11-22\n')
  expect(parseChangelog(out).map((e) => e.yanked)).toEqual([true, false])
})

test('a reason goes under the heading on one line', () => {
  const out = yankChangelog(sample, 'v0.3.1', 'Pins\n vanish  on start')
  expect(out).toContain('## [0.3.1] - 2026-12-01 [YANKED]\n\n**Yanked:** Pins vanish on start\n\n### Fixed')
})

test('the version check then refuses to release that number', () => {
  const out = yankChangelog(sample, '0.3.1')
  expect(checkVersion({ pkgVersion: '0.3.1', changelog: out }).join()).toMatch(/YANKED/)
})

test('refuses unknown, already yanked, Unreleased and non-versions', () => {
  expect(() => yankChangelog(sample, '0.9.9')).toThrow(/no section for 0\.9\.9/)
  expect(() => yankChangelog(yankChangelog(sample, '0.3.1'), '0.3.1')).toThrow(/already marked/)
  expect(() => yankChangelog(sample, 'Unreleased')).toThrow(/not a version/)
  expect(() => yankChangelog(sample, '0.3')).toThrow(/not a version/)
})
