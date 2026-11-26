# Changelog

All notable changes to the Mac app (the code at the root of this repository) are listed here.
The Windows package in `packages/windows` has its own version and `win-v...` tags.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). How versions, tags and skipped versions work is in
[Versions and releases](README.md#versions-and-releases).

A version marked **[YANKED]** was found to be bad. Do not install it; use the next version instead.
Its number is never used again.

## [Unreleased]

### Added
- **Copy setup for Antigravity**: each agent in Settings > Agents has a "Copy setup" menu (Claude Code, Codex, Antigravity, other agents) and a "More" menu (new key, remove), both native Mac menus. The row says when the setup text was copied.
- **Agents can find bookmarks by folder and browser**: `list_browser_bookmarks` now shows each bookmark's folders and browsers, can limit to a folder or a browser, and can read on in steps. A new `list_browser_bookmark_folders` lists the folders with counts. Folders are only read, never changed.
- **Agents can search your history by time and browser**: `list_history` can limit to a time range and to one browser (for example "pages in Dia since yesterday"), tells how many pages match, and can read on in steps, so it is no longer stuck at the newest 2,000 pages.
- **Agents can see which windows they may close**: the window list now also says which window has focus, where it is and how big, and whether the agent itself opened it. Your own windows stay closed to agents, and agents never learn which other agent opened a window.
- **Agents can save and open several pages at once**: one call can save up to 50 pages into an agent folder (one result per page) and open up to 5 windows, behind the current one if the agent asks, or reuse a window that already shows the page. The limit of 5 new windows per minute is unchanged and counts every window opened.
- **Agents can see what they are allowed to do**: `get_settings` now also says which groups of tools you have switched on (windows, pins, pages, settings, actions), so an agent can tell you what to turn on instead of failing. It is read only; agents still can't change those switches.
- **Open the search bar even when another app uses the hotkey** (Mac, off until you turn on "Also let the app in front use the hotkey" in Settings > General): Talaria watches for the hotkey instead of taking it, so the search bar opens and the app in front still gets the key. macOS asks for the Accessibility permission; only key presses that match your hotkey are looked at, and nothing is saved or sent. Without the permission, the normal hotkey is used.
- **Agents never see your passwords and API keys**: when an agent reads a page or takes a screenshot, text that looks like a password or API key is hidden (replaced in text, painted black in pictures).
- **Agents can click, type and scroll in pages** (off until you turn on "Act in pages (click and type)" in Settings > Agents): Talaria asks you the first time an agent acts on each site (allow once, always allow, or don't allow), never types into password, card or one-time-code fields, and lists every action in Recent activity without the typed text.
- **Agents can change some settings** (off until you turn on "Change settings" in Settings > Agents): look and behaviour settings such as pin size and zoom. Each change is in Recent activity with an Undo button. Privacy, security, sync, the search engine, the hotkey and agent settings can never be changed by an agent.
- **Agents can set up pins**: turn a window into a pin, rename a pin, archive it and put it back. Archiving can be undone, and agents can never delete a pin.
- **Agents can see tabs, downloads and site permissions** (read only): the open tabs of your other browsers (only while listing tabs is on), recent downloads in Talaria (addresses without the part after "?", which can hold keys), and the permissions you gave sites.
- **Agents can read pages** (off until you turn on "Read pages" in Settings > Agents): an agent can read the text and links of a page open in a Talaria window or pin, and take a screenshot. Form fields and passwords are never read.
- **Agents (MCP)**: a built-in MCP server (off by default, Settings > Agents) so agents on your Mac, such as Claude Code and Codex, can read your bookmarks, browser bookmarks, history, pins and open windows. It listens on this computer only and needs a key.
- **Agent folders**: agents can make their own bookmark folders, save pages in them and, when the folder allows it, remove them. Your own bookmarks stay read-only for agents. The agent chooses whether it may delete when it makes a folder; after that only you can change it. Settings > Agents lists the folders and can lock or remove any of them.
- **Agents can open windows**: an agent can open a page in a new small window for you, bring a window to the front, and open or offload a pin. Agents cannot close your windows or remove pins.
- **Agent folders in Manage**: a new tab shows the folders agents made. You can open, remove, lock or allow deletion, and move a page to your own bookmarks.
- **One key per agent**: each agent you add in Settings > Agents gets its own key, so agents cannot act as each other. An agent can close only windows it opened. Your old key keeps working as the "Default" agent.
- **Agents can move around in windows**: navigate a window to an address, go back, go forward and reload. Each is logged in Recent activity and follows the Open windows switch.
- **Agent activity and switches**: Settings > Agents lists the changes agents made (not what they read), and has switches for agent folders, opening windows and pins.

### Fixed
- **Settings: the keyboard focus stays where it was.** After you change something with the keyboard, such as a switch or a button, the page no longer loses your place.
- **Agents settings: empty lists and red buttons.** Empty lists show a short grey line instead of an empty row, the Clear button hides when there is nothing to clear, and buttons that remove or clear something are red.
- **Settings: nothing hides under the top strip, and the window works when small.** The page scrolls below the drag strip so every button stays clickable, the sidebar is narrower in a small window, and buttons and sidebar items show a focus ring when you use the keyboard.
- **Agents settings: buttons no longer sit on top of the text.** Each row's buttons stay beside the text when there is room and drop under it when there is not. The Add agent box fits, Enter adds the agent, and Add stays off while the name is empty.
- **Agent folders from the one-key version are no longer claimed by name.** Any agent could be given that name and take them over. They now go to the agent that still holds the old key, or stay unowned (only you can change them).

## [0.3.0] - 2026-11-22

### Changed
- The app is now called **Talaria (QuickPeek)**. The installers are named `Talaria-<version>-mac-<arch>`, the disk image says "Install Talaria", and the menu bar and Settings use the new name.
- New app icon, menu bar icon and website icons.
- Pins use one blue to pink colour gradient.
- Settings are sorted into groups, with a new **Your browsers** group. History settings moved there from Privacy and security.
- The Pin Manager is now **Manage**: one window with a search box (Cmd+F or `/`), tabs with counts (All, Pins, Windows, Bookmarks, History, Browsers, Archive, Other computers), arrow key navigation and a main button on each row.
- Light mode: frosted lavender paper with solid white cards. One pink-violet-blue accent everywhere, which stops moving when the Mac is set to reduce motion.

### Added
- **Bookmarks from your other browsers** (Chrome, Edge, Brave, Arc, Dia, Vivaldi, Firefox), merged so one address is one entry. They show in Manage and in the search bar.
- An optional saved copy of the merged bookmarks, so they are there at start.
- Watching the browsers' bookmark and history files, so changes show a few seconds later.
- **List open tabs** of your other browsers (off by default; macOS asks permission for each browser).
- Bookmarks and History tabs in Manage, with Undo for Remove and Delete.
- A failed pin restore shows **Retry** and **Cancel** instead of failing quietly.
- A privacy policy page on the website.
- New website screenshots in light and dark.
- This changelog, and a check that the version is the same in `package.json`, this file and the release tag.
- **Skip this version** for updates (Settings, About, and the menu bar). A skipped version is never downloaded or installed; a newer one is offered as usual. **Allow again** forgets the skipped versions.
- **Report a problem** in Settings, About opens a GitHub problem report with the Talaria and macOS versions filled in (nothing else), so a bad version can be found and skipped.
- **What's new** in Settings, About opens the release notes of the update on offer, or of the version you run.
- Each GitHub release now shows the CHANGELOG.md section of its version as its release notes.
- `pnpm release:prepare patch|minor|major` sets the next version in `package.json` and moves the Unreleased notes into a dated section.
- `pnpm release:yank x.y.z` marks a bad version `[YANKED]` in this file, with an optional reason, so it is never released again.
- The Mac release refuses a tag that is not on `main`, or that is older than a version already released.
- The Mac check warns on a pull request that changes the app without a CHANGELOG.md line.
- A Mac release is uploaded as a draft and made public only after `latest-mac.yml` and all four installers are checked to carry the version. One Mac release runs at a time.

### Fixed
- The pin corner layout and the website icon shown on pins.
- A released pin could turn into a square; it is now drawn as one picture with transparent corners, and is not redrawn when nothing changed.
- A pin could vanish when its window was let go before its page had drawn.
- Going back to an older version of the app no longer loses every pin.
- Sync: the recovery key could be silently dropped from Drive; the merge no longer depends on which computer merges first; bookmarks kept on this computer only stay out of sync both ways.
- Settings, permissions, history and sync files are saved whole or not at all, so a crash cannot leave half a file.
- Remembering the microphone for a site no longer also allows the camera.
- Two downloads with the same name started together no longer overwrite each other.
- Search bar: new history no longer moves the highlight to another row; only the bar itself can submit or close it; opening it no longer depends on the Mac "show" event.
- History: a browser file that could not be read no longer empties that browser's history.
- Bookmarks: Firefox tags no longer show up as a second copy in a tags folder; bookmarks made in the same millisecond keep a fixed order.
- Local files: a file: link that is not a local path gets the friendly message.

### Security
- Electron 45.3.4 (browser engine fixes), marked 18.2.1.

## [0.2.1] - 2026-11-17

Version number set in `package.json` but never tagged or published.

### Added
- Open local HTML and Markdown files by pasting an absolute path, a `~/` path, a quoted path or a `file://` URL into the search bar or a window's address field. Each open asks permission to read the file's folder until that window closes.
- Markdown is shown with unsafe HTML removed and scripts turned off. HTML runs sandboxed scripts and can use files inside the approved folder only, symlinks included.
- Local paths are left out of web searches, online suggestions and web history.
- Pins, the Pin Manager, search bubbles and the sync core.
- Swipe gestures and search bar improvements.

### Changed
- The Mac and Windows code are separate packages. Windows lives in `packages/windows`, with its own version, checks and `win-v...` tags.
- Trial tags (a version with a dash, such as `0.3.0-rc.1`) are published as pre-releases.
- The winged IB icon.

### Fixed
- The pnpm version in the workflows.
- Link router tests no longer depend on which browsers are installed.
- The smoke test fits small screens.

## [0.2.0] - 2026-11-15

First version: hotkey search bar that opens small floating one-tab browser windows, link router, Dia profile choice,
search bar history, auto-update from GitHub Releases.

[Unreleased]: https://github.com/Phantom-456/instant-browser/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Phantom-456/instant-browser/compare/c520afc...v0.3.0
[0.2.1]: https://github.com/Phantom-456/instant-browser/compare/bfae658...c520afc
[0.2.0]: https://github.com/Phantom-456/instant-browser/commit/bfae658
