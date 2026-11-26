import { expect, test } from 'vitest'
import { parseLatestYml, verifyBuild } from '../../scripts/verify-build.mjs'

// The shape electron-builder writes (taken from a real 0.2.0 build, names changed to the current product name).
const yml = (v: string, drop = '') => [
  `version: ${v}`,
  'files:',
  ...['x64.zip', 'arm64.zip', 'x64.dmg', 'arm64.dmg']
    .filter((s) => s !== drop)
    .flatMap((s) => [`  - url: Talaria-${v}-mac-${s}`, '    sha512: 8JUN2CVEaBPwklmeDF/WPXjO+pzCzdqjtoMzwMV3kojPOiORCwl0PZkeBeUZP5uVGnzskzzxTZHKk+Q9ef1xSA==', '    size: 123981740']),
  `path: Talaria-${v}-mac-x64.zip`,
  'sha512: 8JUN2CVEaBPwklmeDF/WPXjO+pzCzdqjtoMzwMV3kojPOiORCwl0PZkeBeUZP5uVGnzskzzxTZHKk+Q9ef1xSA==',
  "releaseDate: '2026-11-22T07:18:07.947Z'"
].join('\n')
const files = (v: string) => ['arm64.dmg', 'arm64.zip', 'x64.dmg', 'x64.zip'].map((s) => `Talaria-${v}-mac-${s}`).concat('latest-mac.yml')

test('reads the version and the files of latest-mac.yml', () => {
  const parsed = parseLatestYml(yml('0.3.0'))
  expect(parsed.version).toBe('0.3.0')
  expect(parsed.files.map((f) => f.url)).toEqual(['Talaria-0.3.0-mac-x64.zip', 'Talaria-0.3.0-mac-arm64.zip', 'Talaria-0.3.0-mac-x64.dmg', 'Talaria-0.3.0-mac-arm64.dmg'])
  expect(parsed.files[0]).toMatchObject({ size: 123981740 })
  expect(parsed.files[0]?.sha512).toMatch(/==$/)
})

test('a complete build passes', () => {
  expect(verifyBuild({ version: '0.3.0', latestYml: yml('0.3.0'), distFiles: files('0.3.0') })).toEqual([])
})

test('a build with the wrong version stays a draft', () => {
  expect(verifyBuild({ version: '0.3.1', latestYml: yml('0.3.0'), distFiles: files('0.3.0') }).join('\n')).toMatch(/says version 0\.3\.0/)
})

test('a missing installer or update entry is caught', () => {
  const missingFile = files('0.3.0').filter((n) => !n.endsWith('arm64.zip'))
  expect(verifyBuild({ version: '0.3.0', latestYml: yml('0.3.0'), distFiles: missingFile }).join()).toMatch(/arm64\.zip was not built/)
  expect(verifyBuild({ version: '0.3.0', latestYml: yml('0.3.0', 'arm64.dmg'), distFiles: files('0.3.0') }).join()).toMatch(/does not list Talaria-0\.3\.0-mac-arm64\.dmg/)
})

test('no latest-mac.yml at all fails', () => {
  expect(verifyBuild({ version: '0.3.0', latestYml: null, distFiles: [] })).toEqual(['latest-mac.yml is missing, so the auto-updater would find nothing.'])
})

test('pre-release versions work too', () => {
  expect(verifyBuild({ version: '0.4.0-rc.1', latestYml: yml('0.4.0-rc.1'), distFiles: files('0.4.0-rc.1') })).toEqual([])
})
