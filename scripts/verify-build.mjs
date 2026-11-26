#!/usr/bin/env node
// Checks the Mac build before its draft GitHub release is made public:
//   node scripts/verify-build.mjs [dist.noindex]
// latest-mac.yml (what the auto-updater reads) must name the package.json version, and the four installers
// (dmg and zip, Apple silicon and Intel) must exist with that version in their names and a size and checksum.
// If anything is off, the release stays a draft, so nobody is offered a broken or mislabelled update.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ARCHES = ['arm64', 'x64']
const KINDS = ['dmg', 'zip']

/** The parts of latest-mac.yml the updater uses. A small reader, enough for the file electron-builder writes. */
export function parseLatestYml(text) {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1] ?? null
  const files = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const url = /^\s*-\s*url:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (url) { current = { url: url[1], sha512: null, size: null }; files.push(current); continue }
    if (!current || !/^\s{2,}\S/.test(line)) { if (/^\S/.test(line)) current = null; continue }
    const sha = /^\s+sha512:\s*(\S+)/.exec(line)
    const size = /^\s+size:\s*(\d+)/.exec(line)
    if (sha) current.sha512 = sha[1]
    if (size) current.size = Number(size[1])
  }
  return { version, files }
}

/** Problems with a build; empty means it can be published. */
export function verifyBuild({ version, latestYml, distFiles, productPrefix = 'Talaria' }) {
  const problems = []
  if (latestYml == null) return ['latest-mac.yml is missing, so the auto-updater would find nothing.']
  const latest = parseLatestYml(latestYml)
  if (latest.version !== version) problems.push(`latest-mac.yml says version ${latest.version}, but package.json is ${version}.`)
  for (const arch of ARCHES) {
    for (const kind of KINDS) {
      const name = `${productPrefix}-${version}-mac-${arch}.${kind}`
      if (!distFiles.includes(name)) problems.push(`${name} was not built.`)
      const entry = latest.files.find((f) => f.url === name)
      if (!entry) problems.push(`latest-mac.yml does not list ${name}.`)
      else if (!entry.sha512 || !entry.size) problems.push(`latest-mac.yml has no checksum or size for ${name}.`)
    }
  }
  for (const f of latest.files) {
    if (!f.url.includes(`-${version}-`)) problems.push(`latest-mac.yml lists ${f.url}, which is not version ${version}.`)
  }
  return problems
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dist = join(root, process.argv[2] ?? 'dist.noindex')
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const ymlPath = join(dist, 'latest-mac.yml')
  const latestYml = existsSync(ymlPath) ? readFileSync(ymlPath, 'utf8') : null
  const distFiles = existsSync(dist) ? readdirSync(dist).filter((n) => statSync(join(dist, n)).isFile()) : []
  const problems = verifyBuild({ version, latestYml, distFiles })
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`)
    process.exit(1)
  }
  console.log(`Build of ${version} is complete: latest-mac.yml and ${ARCHES.length * KINDS.length} installers match.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
