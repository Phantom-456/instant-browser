#!/usr/bin/env node
// Checks that the Mac app's version is the same everywhere it is set:
//   - package.json "version" is plain semver (1.2.3, or 1.2.3-rc.1 for a trial build)
//   - CHANGELOG.md has a "## [x.y.z] - YYYY-MM-DD" section for it, and it is the newest released section
//   - that version is not marked [YANKED] (a yanked number is never used again)
//   - versions in CHANGELOG.md go strictly down from top to bottom (no reuse, no going back)
//   - on a release tag (v1.2.3), the tag equals package.json
// Run: node scripts/check-version.mjs [--tag v1.2.3] [--notes release-notes.md]
//   GITHUB_REF_NAME is used when --tag is missing. --notes writes the CHANGELOG.md section of this version to a file,
//   which the release workflow uses as the text of the GitHub release.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/** Below zero when a is older than b. Follows semver: 1.0.0-rc.1 < 1.0.0. */
export function compareSemver(a, b) {
  const ma = SEMVER.exec(a)
  const mb = SEMVER.exec(b)
  if (!ma || !mb) throw new Error(`not semver: ${!ma ? a : b}`)
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i])
    if (d !== 0) return d
  }
  const pa = ma[4]
  const pb = mb[4]
  if (pa === pb) return 0
  if (pa === undefined) return 1
  if (pb === undefined) return -1
  const xa = pa.split('.')
  const xb = pb.split('.')
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1
    if (xb[i] === undefined) return 1
    const na = /^\d+$/.test(xa[i])
    const nb = /^\d+$/.test(xb[i])
    if (na && nb) {
      const d = Number(xa[i]) - Number(xb[i])
      if (d !== 0) return d
    } else if (na !== nb) {
      return na ? -1 : 1
    } else if (xa[i] !== xb[i]) {
      return xa[i] < xb[i] ? -1 : 1
    }
  }
  return 0
}

/** The "## [x.y.z] - date" sections of a changelog, top to bottom. */
export function parseChangelog(text) {
  const entries = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^## \[([^\]]+)\](.*)$/.exec(line)
    if (!m || m[1].toLowerCase() === 'unreleased') continue
    const rest = m[2]
    const date = /(\d{4}-\d{2}-\d{2})/.exec(rest)?.[1] ?? null
    entries.push({ version: m[1], date, yanked: /\[YANKED\]/i.test(rest) })
  }
  return entries
}

/** The body of the "## [version]" section of a changelog (without its heading), trimmed. Empty when missing. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
  if (start === -1) return ''
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (/^## \[/.test(line) || /^\[[^\]]+\]: /.test(line)) break
    out.push(line)
  }
  return out.join('\n').trim()
}

/** Files whose change ships to people (the Mac app or its installers) and so belongs in CHANGELOG.md. */
export function shipsToUsers(file) {
  if (file.startsWith('packages/windows/')) return false // its own package
  return /^(src|resources|build)\//.test(file) || file === 'electron-builder.mac.yml' || file === 'electron-builder.yml'
}

/** A note for a pull request that changes the app without a CHANGELOG.md line. Empty when nothing is missing. */
export function changelogReminder(changedFiles) {
  const app = changedFiles.filter(shipsToUsers)
  if (!app.length || changedFiles.includes('CHANGELOG.md')) return ''
  return `This change touches the app (${app.slice(0, 3).join(', ')}${app.length > 3 ? ', ...' : ''}) but not CHANGELOG.md. Add a line under "## [Unreleased]" so the next version lists it.`
}

/** Returns a list of problems; empty means the version is consistent. */
export function checkVersion({ pkgVersion, changelog, tag }) {
  const problems = []
  if (!SEMVER.test(pkgVersion)) problems.push(`package.json version "${pkgVersion}" is not semver (x.y.z or x.y.z-pre.1).`)

  const entries = parseChangelog(changelog)
  for (const e of entries) {
    if (!SEMVER.test(e.version)) problems.push(`CHANGELOG.md section "${e.version}" is not semver.`)
    if (!e.date) problems.push(`CHANGELOG.md section "${e.version}" has no date (## [x.y.z] - YYYY-MM-DD).`)
  }
  const valid = entries.filter((e) => SEMVER.test(e.version))
  for (let i = 1; i < valid.length; i++) {
    if (compareSemver(valid[i - 1].version, valid[i].version) <= 0) {
      problems.push(`CHANGELOG.md is out of order or repeats a version: ${valid[i - 1].version} is above ${valid[i].version}.`)
    }
  }

  const entry = entries.find((e) => e.version === pkgVersion)
  if (!entry) {
    problems.push(`CHANGELOG.md has no "## [${pkgVersion}] - YYYY-MM-DD" section for the package.json version.`)
  } else {
    if (entry.yanked) problems.push(`${pkgVersion} is marked [YANKED] in CHANGELOG.md. Bump to a new version; a yanked number is never reused.`)
    if (entries[0] !== entry) problems.push(`package.json is ${pkgVersion} but the newest CHANGELOG.md section is ${entries[0].version}.`)
  }

  if (tag) {
    const tagVersion = tag.replace(/^v/, '')
    if (!/^v/.test(tag)) problems.push(`Release tag "${tag}" must start with v (for example v${pkgVersion}).`)
    if (tagVersion !== pkgVersion) problems.push(`Release tag ${tag} does not match package.json version ${pkgVersion}.`)
  }
  return problems
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const i = process.argv.indexOf('--tag')
  let tag = i > -1 ? process.argv[i + 1] : undefined
  // Only Mac release tags (v...) are checked; win-v... tags belong to packages/windows.
  if (!tag && process.env.GITHUB_REF_TYPE === 'tag' && /^v\d/.test(process.env.GITHUB_REF_NAME ?? '')) tag = process.env.GITHUB_REF_NAME
  const c = process.argv.indexOf('--changed')
  if (c > -1) {
    // A list of changed files (one per line) from the pull request; only a warning, never a failure.
    const files = readFileSync(process.argv[c + 1], 'utf8').split(/\r?\n/).filter(Boolean)
    const note = changelogReminder(files)
    if (note) console.log(`::warning file=CHANGELOG.md::${note}`)
  }
  const problems = checkVersion({ pkgVersion, changelog, tag })
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`)
    process.exit(1)
  }
  console.log(`Version ${pkgVersion} is consistent${tag ? ` with tag ${tag}` : ''}.`)
  const n = process.argv.indexOf('--notes')
  if (n > -1) {
    const file = process.argv[n + 1]
    if (!file) { console.error('::error::--notes needs a file name.'); process.exit(1) }
    const body = changelogSection(changelog, pkgVersion)
    writeFileSync(file, `${body || 'See CHANGELOG.md.'}\n\nFull list of changes: [CHANGELOG.md](https://github.com/Phantom-456/instant-browser/blob/v${pkgVersion}/CHANGELOG.md)\n`)
    console.log(`Release notes for ${pkgVersion} written to ${file}.`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
