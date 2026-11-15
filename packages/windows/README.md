# Instant Browser for Windows

The Windows package of Instant Browser. **It is early and not validated.** It is managed on its own, so a Windows problem never blocks the Mac package.

## Status

- The code has Windows paths (browser discovery in the registry, links from other apps, history locations, Ctrl keys). Most of it was written on a Mac and has never been run on Windows.
- Known gaps: Windows tray icons, window minimise and maximise buttons, the glass look, reading held keys for the link router, the default-app registration check, and a real test of the pins (transparent, click-through windows).
- **Follow me to every desktop is not available.** Electron cannot show a window on every Windows virtual desktop, so the Follow buttons are hidden.
- The two-finger swipe uses the same code as on the Mac. It has not been tried on a Windows touchpad.

## Requirements

Windows 10 or 11, 64-bit.

## Build it

```bash
pnpm install
pnpm dist:win          # an unpacked app folder, for trying it
pnpm dist:win:release  # the NSIS installer (x64), not signed
```

The Windows build uses `electron-builder.win.yml`. It extends the shared `electron-builder.yml`. The first builds are unsigned, so SmartScreen warns: choose More info, then Run anyway.

## Test it

```bash
pnpm typecheck
pnpm test
```

Only these two run on Windows in the check. The app tests (`pnpm smoke`) were written for the Mac and are not part of the Windows check yet.

## Release it

Push a tag that starts with `win-v`, for example `win-v0.3.0`. The workflow `.github/workflows/release-windows.yml` builds the installer and puts it in GitHub Releases **as a pre-release**. A pre-release is never "latest", so the Mac updater and the Mac download button never see it. The download page looks for the newest `win-v` release for its Windows button.

## Updates

Auto-update on Windows is not switched on. A Windows release is a pre-release, which the updater does not follow. This will be decided after Windows has been tested on a real PC.

## Checking it

A person has to test on a Windows PC: install, launch, the tray icon in both themes, hotkey focus, the default-app entry, links from Teams, display scaling, and uninstall. Record the results in the project notes.
