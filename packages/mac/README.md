# Instant Browser for Mac

The macOS package of Instant Browser. It is the one that is tested every day and the one the auto-updater serves.

**The Mac codebase is the root of this repository** (`src`, `tests`, `package.json`, `electron-builder.mac.yml` ...). This folder only holds this README. The Windows codebase is separate, in [packages/windows](../windows/README.md), and shares no code with the Mac one.

## What you get

A menu bar app with no Dock icon. Press the hotkey, type a search, and a small browser window opens. Collapse windows into pins, offload them to save memory, and manage them in the Pin Manager. The full list of features is in the [main README](../../README.md).

## Requirements

macOS 12 or newer, Apple silicon or Intel.

## Build it

Run these at the root of the repository:

```bash
pnpm install
pnpm dist:mac          # an unsigned app in dist.noindex/mac-arm64/Instant Browser.app
pnpm dist:mac:release  # dmg and zip for Apple silicon and Intel (signed only if the Apple secrets exist)
```

The Mac build uses `electron-builder.mac.yml`. It extends the shared `electron-builder.yml`.

## Test it

```bash
pnpm typecheck
pnpm test
pnpm smoke     # starts the real app and drives it (needs a Mac and a screen)
```

## Release it

Push a tag that starts with `v`, for example `v0.3.0`. The workflow `.github/workflows/release-mac.yml` builds the dmg and zip files and puts them in GitHub Releases.

With the Apple secrets (`MAC_CERTIFICATE_P12_BASE64`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) it signs and notarizes. Without them the files are unsigned and macOS shows a warning on the first open.

The app checks these Releases for updates (Settings, Privacy and security, Update automatically). Auto-update works only for a signed and notarized build.

## Mac only features

- The link router: hold Option and Command while you click a link to open it in a small window. Dia profiles.
- **Follow me to every desktop**, for windows and pins.
- The glass look (vibrancy).

## Known limits

- Not signed yet, so no auto-update and a warning on the first open.
- Desktop (Space) names are not shown: macOS gives apps no way to read them.
