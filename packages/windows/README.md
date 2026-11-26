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
- Known gaps: Windows tray icons, window minimise and maximise buttons, the glass look, and a real test of the pins by hand (transparent, click-through windows).
- **Default browser:** the installer registers the app as a web browser for this user, so it is listed in Settings, Apps, Default apps (Windows never lets an app pick itself). Settings, Open system settings goes there. The uninstaller removes the registration. The GitHub check installs and uninstalls it on Windows to prove this.
- **Tray icon:** white on a dark taskbar and black on a light one. A left click opens the search bar; the right click has the menu. Windows 11 puts a new app's tray icon in the hidden overflow (the ^ or > arrow) at first: to keep it on the taskbar, drag it out, or turn it on in Settings, Personalization, Taskbar, Other system tray icons.
- **Pins:** Offload works with hidden windows (Windows cannot photograph a hidden window, so the picture is taken just before the page collapses).
- **Link router:** with the app as the default browser, a link clicked in another app goes to your main browser. Hold **Control+Alt** (or Alt+Shift, or Control+Shift, in Settings) while you click to open it in a small window instead. Links from Windows Terminal, PowerShell, Command Prompt, VS Code and similar apps open in a small window without keys. A small PowerShell helper reads the keys and the app in front; it runs only while the router can be used. If it cannot answer, the link opens in a small window, so no link is lost. The Windows key is not offered, because letting it go opens the Start menu.
- **Follow me to every desktop is not available.** Electron cannot show a window on every Windows virtual desktop, so the Follow buttons are hidden.
- **Agents (MCP), parts 1 and 2:** a built-in server on 127.0.0.1 (off by default) lets agents such as Claude Code and Codex read history, pins, windows, site permissions and downloads, open and steer windows, set up pins and keep their own bookmark folders. Three more switches, all off by default, let them read pages and take screenshots, change safe settings (with Undo), and click, type and scroll on sites you approve. Settings, Agents. Which tools exist on Windows and which are Mac-only is in [docs/mcp.md](docs/mcp.md).
- The two-finger swipe uses the same code as on the Mac. It has not been tried on a Windows touchpad.

## The hotkey on Windows

- The default is **Control+Alt+B**. The first default, Control+Alt+Space, was already held by another app on a Windows 11 test PC; a PC that still has it saved moves to Control+Alt+B and says so once. If you never chose a key and the default is taken, the app uses the first free one of **Alt+Shift+Space** and **Control+Alt+Shift+Space**, saves it, and tells you in a notification. A key you chose yourself is never replaced.
- **The Windows key cannot be part of the hotkey.** Electron registers global keys without it, so Windows+Space would take plain Space from every app. The recorder refuses it.
- **Keyboards with AltGr** (German, Polish, Hungarian and others): Windows treats AltGr as Control+Alt. If AltGr+B types a character on your layout (on Hungarian it types {), the hotkey takes that key away from typing. Choose another key in Settings, for example Alt+Shift+Space.
- **Holding the hotkey** opens the bar once. Windows repeats a held key; presses closer together than your keyboard repeat delay (Settings, Keyboard) plus a little are counted as one.

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

`pnpm smoke` starts the real app and drives it. Every smoke test runs on Windows in the GitHub check (`smoke` job in `check-windows.yml`).

The build settings are all in `electron-builder.yml` in this folder. The first builds are unsigned, so SmartScreen warns: choose More info, then Run anyway.

## Release it

Push a tag that starts with `win-v`, for example `win-v0.1.0`. The workflow `.github/workflows/release-windows.yml` builds the installer from this folder and puts it in GitHub Releases **as a pre-release**. A pre-release is never "latest", so the Mac updater and the Mac download button never see it. The download page looks for the newest `win-v` release for its Windows button.

The version of this package (`package.json` here) is its own and starts at 0.1.0.

## Updates

Auto-update on Windows is not switched on (`WINDOWS_AUTO_UPDATE` in `src/main/updater.ts`). Settings says so, and "Check for Updates" in the tray menu is greyed out. This will be decided after Windows has been tested on a real PC.

When it is switched on, the app reads the releases feed, picks the newest `win-v` release by version number, and points the updater at that release's `latest.yml`. electron-updater's own GitHub reader would ask for the latest full release, which is a Mac release, and fail. Test tags such as `win-v0.2.0-rc1` are not offered.

## Pushing from the Windows PC

Commit and push your changes to this repository as usual. The tool that publishes the Mac code never overwrites this folder (it is listed as owned by the public repository), so your work is safe. The Mac side copies this folder back for its own records when it needs to.

## Checking it

A person has to test on a Windows PC: install, launch, the tray icon in both themes, hotkey focus, the default-app entry, links from Teams, display scaling, and uninstall.
