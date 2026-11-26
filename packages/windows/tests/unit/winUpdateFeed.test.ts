import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { WIN_RELEASES, latestWindowsTag, releaseFilesUrl, releasesFeedUrl } from '../../src/shared/winUpdateFeed'

const entry = (tag: string) =>
  `<entry><id>tag:github.com,2008:Repository/1/${tag}</id><link rel="alternate" type="text/html" href="https://github.com/Phantom-456/instant-browser/releases/tag/${tag}"/><title>${tag}</title></entry>`
const feed = (...tags: string[]) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${tags.map(entry).join('')}</feed>`

test('the newest Windows release is found among Mac releases', () => {
  expect(latestWindowsTag(feed('v1.4.0', 'win-v0.2.0', 'v1.3.0', 'win-v0.1.0'))).toBe('win-v0.2.0')
})

test('the order is by version number, not by place in the feed', () => {
  expect(latestWindowsTag(feed('win-v0.9.0', 'win-v0.10.0', 'win-v0.2.1'))).toBe('win-v0.10.0')
})

test('no Windows release, or only test builds, means nothing to offer', () => {
  expect(latestWindowsTag(feed('v1.4.0', 'v1.3.0'))).toBeNull()
  expect(latestWindowsTag(feed('win-v0.3.0-rc1', 'win-vx'))).toBeNull()
  expect(latestWindowsTag('')).toBeNull()
  expect(latestWindowsTag('<html>rate limited</html>')).toBeNull()
})

test('the addresses point at this repository', () => {
  expect(releasesFeedUrl()).toBe('https://github.com/Phantom-456/instant-browser/releases.atom')
  expect(releaseFilesUrl('win-v0.2.0')).toBe('https://github.com/Phantom-456/instant-browser/releases/download/win-v0.2.0')
})

test('the owner, repository and tag prefix match the release settings in electron-builder.yml', () => {
  const yml = readFileSync(join(__dirname, '../../electron-builder.yml'), 'utf8')
  expect(yml).toMatch(new RegExp(`owner: ${WIN_RELEASES.owner}\\b`))
  expect(yml).toMatch(new RegExp(`repo: ${WIN_RELEASES.repo}\\b`))
  expect(yml).toMatch(new RegExp(`tagNamePrefix: ${WIN_RELEASES.tagPrefix}\\b`))
})
