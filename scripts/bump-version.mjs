#!/usr/bin/env node
// Prepares a Mac release in one step, so package.json and CHANGELOG.md never disagree:
//   node scripts/bump-version.mjs patch|minor|major|1.2.3[-rc.1] [--date YYYY-MM-DD]
// It sets package.json "version", turns "## [Unreleased]" into "## [x.y.z] - date" (leaving a new empty
// Unreleased section above it), updates the compare links at the bottom, and runs the version check.
// It does not commit, tag or push: review the diff, merge, then push the tag vX.Y.Z.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkVersion, compareSemver, parseChangelog } from './check-version.mjs'

const REPO = 'https://github.com/Phantom-456/instant-browser'

/** The version after current for a bump kind, or the exact version given. */
export function nextVersion(current, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(current)
  if (!m) throw new Error(`package.json version "${current}" is not semver.`)
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const pre = m[4]
  switch (kind) {
    // 1.2.3-rc.1 -> patch gives 1.2.3 (the release of the trial), like npm version.
    case 'patch': return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`
    case 'minor': return pre && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`
    case 'major': return pre && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`
    default: return kind.replace(/^v/, '')
  }
}

/** The changelog with the Unreleased notes moved into a new dated section for version. */
export function releaseChangelog(text, version, date) {
  if (parseChangelog(text).some((e) => e.version === version)) throw new Error(`CHANGELOG.md already has a section for ${version}.`)
  const lines = text.split('\n')
  const at = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l))
  if (at === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section.')
  let end = lines.findIndex((l, i) => i > at && (/^## \[/.test(l) || /^\[[^\]]+\]: /.test(l)))
  if (end === -1) end = lines.length
  const notes = lines.slice(at + 1, end).join('\n').trim()
  if (!notes) throw new Error('Nothing under "## [Unreleased]" in CHANGELOG.md. Write what changed first.')
  const before = lines.slice(0, at)
  const after = lines.slice(end)
  let out = [...before, '## [Unreleased]', '', `## [${version}] - ${date}`, '', notes, '', ...after].join('\n')

  // Compare links: Unreleased now starts at the new tag, and the new version gets its own.
  const prev = parseChangelog(text)[0]?.version
  const unreleasedLink = `[Unreleased]: ${REPO}/compare/v${version}...HEAD`
  const versionLink = `[${version}]: ${REPO}/compare/${prev ? `v${prev}` : 'HEAD'}...v${version}`
  if (/^\[Unreleased\]: .*$/m.test(out)) out = out.replace(/^\[Unreleased\]: .*$/m, `${unreleasedLink}\n${versionLink}`)
  else out = `${out.trimEnd()}\n\n${unreleasedLink}\n${versionLink}\n`
  return out
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const kind = process.argv[2]
  if (!kind) {
    console.error('Usage: pnpm release:prepare patch|minor|major|x.y.z [--date YYYY-MM-DD]')
    process.exit(1)
  }
  const d = process.argv.indexOf('--date')
  const date = d > -1 ? process.argv[d + 1] : new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('--date must be YYYY-MM-DD.')

  const pkgPath = join(root, 'package.json')
  const logPath = join(root, 'CHANGELOG.md')
  const pkgText = readFileSync(pkgPath, 'utf8')
  const current = JSON.parse(pkgText).version
  const version = nextVersion(current, kind)
  if (compareSemver(version, current) <= 0) throw new Error(`${version} is not newer than ${current}.`)

  const changelog = releaseChangelog(readFileSync(logPath, 'utf8'), version, date)
  const problems = checkVersion({ pkgVersion: version, changelog })
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`)
    process.exit(1)
  }
  writeFileSync(pkgPath, pkgText.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`))
  writeFileSync(logPath, changelog)
  console.log(`${current} -> ${version}. Review the diff, merge it, then push the tag v${version}.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main()
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
