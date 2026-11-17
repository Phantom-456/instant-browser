import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalFileGrant, localTarget, localPath, markdownPage } from '../../src/main/localFiles'
import { isLocalInput } from '../../src/shared/localInput'
import { resolveInput } from '../../src/shared/resolveInput'
import { suggestEndpoint } from '../../src/shared/suggest'
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'ib-local-'))); dirs.push(dir)
  const root = join(dir, 'page'); await mkdir(root)
  const path = join(root, 'hello #%.md'); await writeFile(path, '# Hello\n\n**World**')
  await writeFile(join(dir, 'private.txt'), 'private')
  return { dir, root, path, grant: new LocalFileGrant(root, 'test') }
}
test('paths never become searches or remote suggestions, including quoted and Windows paths', () => {
  for (const path of ['/Users/me/a file.html', 'file:///tmp/page.md', '~/notes.md', 'C:\\notes\\readme.md', '\\\\server\\share\\a.html', '"/tmp/a.html"', '/']) {
    expect(isLocalInput(path)).toBe(true)
    expect(resolveInput(path)).toBeNull()
    expect(suggestEndpoint('https://www.google.com/search?q=%s', path)).toBeNull()
  }
  expect(isLocalInput('ordinary search')).toBe(false)
  expect(localPath('file:///tmp/a%20b.md')).toBe('/tmp/a b.md')
})
test('valid files render Markdown and grant expires, including other windows', async () => {
  const { path, root, grant } = await fixture()
  expect(await localTarget(path)).toEqual({ path, root })
  const url = grant.url(path)
  const response = await grant.respond({ url, method: 'GET' })
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('<strong>World</strong>')
  expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'none'")
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect((await new LocalFileGrant(root, 'other').respond({ url, method: 'GET' })).status).toBe(403)
  grant.revoke()
  expect((await grant.respond({ url, method: 'GET' })).status).toBe(403)
})
test('rejects traversal, symlink escapes, malformed paths, writes and directories', async () => {
  const { root, dir, grant } = await fixture()
  await symlink(join(dir, 'private.txt'), join(root, 'escape.txt'))
  for (const suffix of ['escape.txt', '%2e%2e%2fprivate.txt', '%2F..%2Fprivate.txt', '%5c..%5cprivate.txt', '%00', '%ZZ', '']) {
    expect((await grant.respond({ url: `instant-local://test/${suffix}`, method: 'GET' })).status).toBe(403)
  }
  expect((await grant.respond({ url: 'instant-local://test/a.md', method: 'POST' })).status).toBe(403)
  await expect(localTarget(root)).rejects.toThrow()
})
test('Markdown removes scripts, embedded frames, event handlers and unsafe URLs', () => {
  const html = markdownPage('# Hi\n<script>alert(1)</script><iframe src="https://evil.test"></iframe><img src="x.png" onerror="alert(1)">\n\n[x](javascript:alert)\n\n![image](pic.png)')
  expect(html).not.toMatch(/<script|<iframe|onerror|javascript:/i)
  expect(html).toContain('src="pic.png"')
  expect(html).toContain('<h1>Hi</h1>')
})
