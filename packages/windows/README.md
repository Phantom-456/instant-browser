# Instant Browser for Windows

This folder is the **Windows codebase** of Instant Browser. It is a complete app of its own: its own `src`, `tests`, `package.json`, lock file, build settings and releases. It started as a copy of the Mac code on 17 November 2026 and shares **no code** with it. A change here never touches the Mac app, and a change to the Mac app never lands here by itself.

**It is early and not validated.**

## Rules for working here

- Work **only in this folder**. Run every command inside `packages/windows` (`cd packages/windows`).
- Do not import anything from outside this folder.
- If a fix for a bug that both apps have is made on one side, it must be copied by hand to the other side. Nobody does it for you.
- The Mac code is at the root of the repository (`src`, `tests` ...). Leave it alone.
- The GitHub checks for this folder run only when something in `packages/windows` changes (`check-windows.yml`).

## Status

- The code has Windows paths (browser discovery in the registry, links from other apps, history locations, Ctrl keys). Most of it was written on a Mac and has never been run on Windows.
- Known gaps: Windows tray icons, window minimise and maximise buttons, the glass look, reading held keys for the link router, the default-app registration check, hotkey conflicts, and a real test of the pins (transparent, click-through windows).
- **Follow me to every desktop is not available.** Electron cannot show a window on every Windows virtual desktop, so the Follow buttons are hidden.
- The two-finger swipe uses the same code as on the Mac. It has not been tried on a Windows touchpad.

## Requirements

Windows 10 or 11, 64-bit.

## Run, test and build

```bash
cd packages/windows
pnpm install
pnpm dev                # run the app
pnpm typecheck
pnpm test               # unit tests (these run in the GitHub check)
pnpm dist:win           # an unpacked app folder, for trying it
pnpm dist:win:release   # the NSIS installer (x64), not signed
```

`pnpm smoke` starts the real app and drives it. Those tests were written for the Mac and need changes before they run on Windows.

The build settings are all in `electron-builder.yml` in this folder. The first builds are unsigned, so SmartScreen warns: choose More info, then Run anyway.

## Release it

Push a tag that starts with `win-v`, for example `win-v0.1.0`. The workflow `.github/workflows/release-windows.yml` builds the installer from this folder and puts it in GitHub Releases **as a pre-release**. A pre-release is never "latest", so the Mac updater and the Mac download button never see it. The download page looks for the newest `win-v` release for its Windows button.

The version of this package (`package.json` here) is its own and starts at 0.1.0.

## Updates

Auto-update on Windows is not switched on. A Windows release is a pre-release, which the updater does not follow. This will be decided after Windows has been tested on a real PC.

## Pushing from the Windows PC

Commit and push your changes to this repository as usual. The tool that publishes the Mac code never overwrites this folder (it is listed as owned by the public repository), so your work is safe. The Mac side copies this folder back for its own records when it needs to.

## Checking it

A person has to test on a Windows PC: install, launch, the tray icon in both themes, hotkey focus, the default-app entry, links from Teams, display scaling, and uninstall.
