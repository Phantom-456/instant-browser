#!/usr/bin/env node
// Marks a bad Mac version as yanked in CHANGELOG.md, so it is never released or reused again:
//   node scripts/yank-version.mjs 0.3.1 [--reason "Pins vanish on start"]
// It adds [YANKED] to the version's heading and, with --reason, a "**Yanked:** reason" line under it.
// It does not touch GitHub: it prints the command that turns the release into a pre-release, so the
// updater and the website stop offering it. Then release the fix as the next number.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseChangelog } from './check-version.mjs'

/** The changelog with version's heading marked [YANKED], and an optional reason line under it. */
export function yankChangelog(text, version, reason) {
  const clean = String(version ?? '').replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(clean)) throw new Error(`"${version}" is not a version like 0.3.1.`)
  const entry = parseChangelog(text).find((e) => e.version === clean)
  if (!entry) throw new Error(`CHANGELOG.md has no section for ${clean}.`)
  if (entry.yanked) throw new Error(`${clean} is already marked [YANKED].`)
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l.startsWith(`## [${clean}]`))
  lines[at] = `${lines[at].trimEnd()} [YANKED]`
  const why = String(reason ?? '').replace(/\s+/g, ' ').trim()
  if (why) lines.splice(at + 1, 0, '', `**Yanked:** ${why}`)
  return lines.join('\n')
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const version = process.argv[2]
  if (!version || version.startsWith('--')) {
    console.error('Usage: pnpm release:yank x.y.z [--reason "what is wrong"]')
    process.exit(1)
  }
  const r = process.argv.indexOf('--reason')
  const reason = r > -1 ? process.argv[r + 1] : undefined
  const logPath = join(root, 'CHANGELOG.md')
  writeFileSync(logPath, yankChangelog(readFileSync(logPath, 'utf8'), version, reason))
  const clean = version.replace(/^v/, '')
  console.log(`Marked ${clean} as [YANKED] in CHANGELOG.md. Merge that, then stop offering the release:`)
  console.log(`  gh release edit v${clean} --prerelease`)
  console.log('Then release the fix as the next number with pnpm release:prepare patch.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main()
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
