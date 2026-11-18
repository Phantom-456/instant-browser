# Talaria (QuickPeek)

Talaria (QuickPeek) is a small background app for Mac (a Windows package is in progress). You press a hotkey, type a search, and a small one-tab browser window opens on top of the app you are working in. You can close it, or send the page to any browser you have installed.

## Two packages

The app comes as two separate codebases in one repository. Each has its own README, build, check and release:

| Package | Folder | State |
|---|---|---|
| **macOS** | the root of this repository ([notes](packages/mac/README.md)) | Tested. Release tags `v...`. Auto-update (when signed). |
| **Windows** | [packages/windows](packages/windows/README.md) | Early, not validated. Release tags `win-v...`, always pre-releases. |

They share **no code**. The Windows codebase is a full copy in `packages/windows` with its own sources, tests, lock file and build settings, so work on Windows never touches the Mac app. A fix that both need is copied by hand. The GitHub checks are separate too (`check-mac.yml` and `check-windows.yml`), and each starts only when its own code changes.

## Install

Download it from the project page: **https://phantom-456.github.io/instant-browser/** (Mac and Windows). The files are in GitHub Releases. The app updates itself.

## Local files (0.2.1)

Paste an absolute HTML or Markdown path into the search bar or a window's address field. `~/` paths, quoted paths, and `file://` URLs are supported. Each open asks permission to read the file's containing folder until that window closes. Cancel grants nothing; reopening asks again. Local paths are excluded from web searches, online suggestions, and web history.

HTML can run sandboxed scripts and use supporting files within the approved folder. Markdown is rendered with unsafe embedded HTML removed and scripts disabled. Files outside the folder, including symlinks pointing outside, are blocked. Open another file's path explicitly for a separate permission prompt. Pages using application-server routes still need their server for complete styling and navigation.

See [0.2.1 patch notes](docs/patch-0.2.1.md).

## Run it from the code

```bash
pnpm install
pnpm dev
```

If Electron does not start after install, run `node node_modules/electron/install.js` once.

## Test it

```bash
pnpm typecheck
pnpm test
pnpm smoke
```

## Build the apps

```bash
pnpm dist:mac   # the Mac app (see packages/mac)
cd packages/windows && pnpm install && pnpm dist:win   # the Windows app folder (see packages/windows)
```

The app is `dist.noindex/mac-arm64/Instant Browser.app`. It is not signed. The first start may need right-click, Open. It has no Dock icon; look for the icon in the menu bar. It lists itself as a web browser in System Settings, but it never changes your default browser by itself.

## Look

The windows use macOS glass (vibrancy), soft round shapes and small hover animations. Light and dark follow the system. The address bar is a label until you hover or click it. Icons are from Phosphor (MIT licence). The app icon is made from `build/icon.png`.

## Use it

- Hotkey: **Control+Option+Space** opens the search bar. Esc closes it. Enter opens a mini window.
- Type a web address, or words to search. Your search engine's suggestions show under the field (Google, DuckDuckGo and Bing). You can turn them off in Settings; they send what you type to the search engine.
- Google may sometimes ask "are you a robot?". Solve it once; the answer is kept. The app does not hide that it is Electron. If it keeps coming, choose another search engine in Settings.
- In a mini window:

| Keys | Action |
|---|---|
| Cmd+L | Go to the address field |
| Cmd+W | Close |
| Cmd+R | Reload |
| Cmd+[ and Cmd+] | Back and forward |
| Cmd+Shift+M | Send the page to your main browser and close |
| Cmd+Shift+O | Choose a browser to send to |

- Windows stay above other apps (Settings > Appearance). The pin button collapses a window to a pin (see Pins below).
- A window stays on the desktop where you opened it. The follow button (two squares, Mac only for now) makes that window follow you to other desktops.
- Sending moves only the address. Text you typed in a page and did not send is lost.

## Pins

The pin button in the toolbar collapses the window. The whole window shrinks into a small pin on the desktop, where the button was. The page stays alive behind the pin.

- **Hold the pointer on a pin for 2 seconds.** It opens as a capsule with the page name and address, and the gradient border draws itself around it while it arms. Until then, clicks go through to the app behind it. When it is ready, click the pin to open the window again, where it was.
- **Follow** (right of the pin) makes the pin and its window follow you to every desktop.
- **Offload** (below): drag the small bubble toward the pin. The page is saved as a picture and released from memory. The pin goes dormant (a faint disc with a dot at rest, a border only when you point at it). Click the pin and the window grows back with the saved picture, then the live page loads and the scroll position comes back. A click on the Offload bubble pauses its countdown, a right-click goes on.
- **Remove** (above) takes the pin away and keeps it in an archive.
- Click the name to rename it (up to 60 characters). Drag the pin to move it.
- Pins come back after a restart as released pins.
- **Automatic Offload** is off until you turn it on in Settings > Pins: by time without use, or when the app uses more memory than a limit you choose (the oldest pins go first; paused pins stay).

**Memory, honestly:** a pin whose page is alive has a small window of its own that costs about 20 MB (the macOS memory figure, measured). Offload frees the page behind the pin (about 190 MB for a heavy test page). A pin whose page is released has no page process at all while you leave it alone: it is a bare round window. It looks different at rest (a faint disc with a dot) and turns into the full pin when you point at it. The most pins at once is 12 by default (4 to 40 in Settings). The menu bar icon has a Pins list with Open, Offload and Remove for each pin.

## Pin Manager

Open it from the menu bar icon (Pin Manager), from the round bubble to the right of the search bar, or with Cmd+Shift+P while the search bar is open. It lists:

- **Pins**: name, address, colours, and whether the page is in memory or released. Open, Rename (double-click the name), Offload, Follow, Details and Remove.
- **Open windows**: Show or Close. An open window is not a pin.
- **Archive**: pins you removed. **Put back** shows the pin again (released). **Delete for good** asks first and cannot be undone.

macOS does not tell apps the names or numbers of your desktops, so pins are listed in one place. A pin whose desktop is gone is still listed and opens from here.

The round **Settings** bubble beside the search bar opens a menu of settings sections when you hover it (Cmd+, does the same from the keyboard).

## Google Drive sync (optional)

Settings, Sync, **Connect Google Drive**. Your normal browser opens Google's page; you sign in and allow one permission: the app data folder of your Drive (`drive.appdata`). That is one hidden folder only this app can see. The app cannot see the rest of your Drive.

- **Locked on your computer first.** You choose a passphrase once. The synced file is encrypted (AES-256-GCM) before it is uploaded, so Google only holds scrambled data. Type the same passphrase once on each other computer. If you forget it and have no other unlocked computer, the synced data cannot be recovered (you delete the file and start again).
- **Synced:** your pins (address, title, the name you gave, archived or not), your **bookmarks** (one list for your whole account; the star in the window toolbar), a short list of settings, and, with their own switches, **history** you made in this app and the **pages open on each computer** (shown in the Pin Manager with "Open here"). Pins from another computer arrive released and never open a window by themselves.
- **Never synced:** passwords, cookies, logged-in sessions, site data, saved pictures of released pages, where windows and pins sit on screen, and the history of your other browsers.
- **Sync now:** Settings, Sync, or the first item in the menu of the Settings bubble beside the search bar, or Cmd+Shift+S in the search field, or the menu bar icon. It also syncs when you quit the app (at most 4 seconds) and before the computer sleeps, and again after it wakes.
- It syncs a few seconds after a change, every 10 minutes, and at start. Offline is fine: it tries again later. When two computers change the same pin, the newest change wins. A pin deleted for good on one computer is deleted on the others.
- **Disconnect** stops syncing on this computer. **Disconnect and delete synced data** also deletes the file from your Drive. You can also remove the permission at myaccount.google.com/permissions.
- Builds made without a Google login key (for example from the public code) show "This build cannot connect to Google Drive." To make your own, create a Google Cloud desktop client and put `MAIN_VITE_GOOGLE_CLIENT_ID` and `MAIN_VITE_GOOGLE_CLIENT_SECRET` in a file named `.env.local` (never commit it).
- The privacy policy is on the download page (privacy.html).

## Search bar history

Press the hotkey with nothing typed and the bar shows bubbles: quick Settings links and your recent searches, then recently visited pages. When you type, it shows matching history first, then your search engine's suggestions, and Settings bubbles that match.

The history comes from the history files of Dia, Arc, Google Chrome, Edge, Brave, Firefox and Zen on this computer, plus what you opened from the bar. Search words are read from the addresses of search pages (Google, DuckDuckGo, Bing, Brave, Yahoo, Ecosia).

- A separate process reads the history files, so the app never freezes. Each file is copied to a temporary file, read, and the copy is deleted.
- The bar shows old data first, then updates itself when newer data is ready. A file is read again only when it changed (its size or time is different), and the bar looks at that at most every 5 minutes.
- To show old data at once after a restart, a small **saved copy** is kept in the app's data folder (`history-cache.json`). It holds the addresses, titles and times of up to about 1,500 recent rows per browser file. It is readable only by your user, stays on this computer and is never sent anywhere. Turning history off, or "Clear what Instant Browser remembers" in Settings, deletes it.
- Only history is read. **Cookies, passwords and saved cards are never read.**
- You can turn history off, or leave out single browsers, in Settings > Privacy and security. Safari is not read.
- If macOS blocks a browser's folder (Chrome may), that browser is skipped.

## Speed and memory

- **Ready window:** the app keeps one hidden window ready, so the next small window opens at once. It uses about 40 MB of memory while it waits, and it is let go after 10 minutes without use. Turn it off in Settings > General > "Keep a window ready".
- The window shows the address and a loader (in the address bar) the moment you press Enter, before the page answers.
- The connection to your search engine is opened in advance.
- Memory use measured on a Mac (Apple silicon), all processes together: about 335 MB at rest, and about 180 to 210 MB for each open small window.

## Dia profiles

In Settings > General you can choose which Dia profile "send to browser" opens pages in. The three dots button also lists the profiles. This uses Dia's own AppleScript interface and reads only profile names. macOS asks once to let Instant Browser control Dia. When Dia is not running, or the profile is gone, the page opens in Dia normally.

## Link router

If you make Instant Browser your default browser, every link you click in another app (Teams, Slack, mail) reaches it first. It then sends the link to your main browser as a new tab, unless you hold **Option+Command** while you click: then the link opens in a small window. You can change the keys, or turn the router off, in Settings. It works only while Instant Browser is the default browser. Links that come from a terminal or a code editor (for example from `gh auth login`) open in a small window with no keys needed; you can turn that off in Settings. In Settings, General, "Default browser" shows which app macOS sends links to now, and a "Make default" button asks macOS to switch; macOS asks you to confirm, and nothing changes until you do. The app never changes your default by itself.

## Settings

Open **Settings** from the menu bar icon, or press Cmd+, in a mini window. Changes apply at once. To change the hotkey, click **Change**, then press the new keys (for example Command+Option+B). The hotkey is saved on this computer only and is never synced.

The values are saved in a file you can also edit by hand when the app is closed:

`~/Library/Application Support/instant-browser/settings.json`

| Key | Meaning |
|---|---|
| `hotkey` | Key to open the search bar, for example `Control+Alt+Space` |
| `searchTemplate` | Search address with `%s` where the words go |
| `mainBrowserId` | Browser used by "send" (Mac bundle id, for example `company.thebrowser.dia`) |
| `alwaysOnTop` | New windows stay on top |
| `windowSize` | Size of new windows (it follows the last resize) |
| `launchAtLogin` | Start the app when you log in |
| `defaultZoom` | Page zoom, 0.5 to 3 |
| `httpsFirst` | Try https before http |
| `sendGpc` | Send the Global Privacy Control signal |
| `updateNotice` | Tell me when the browser engine is out of date |
| `askDownloadLocation` | Ask where to save each download |
| `downloadFolder` | Folder for downloads when not asking |

## Security compared to Google Chrome

The engine is the same Chromium, so most of the protection is the same. Some of Chrome's protection is a Google service and does not come with Electron.

| Protection | Chrome | Instant Browser |
|---|---|---|
| Sandbox for web pages | Yes | Yes (`sandbox: true` on every page) |
| Site isolation (each site in its own process) | Yes | Yes (Chromium default, kept on) |
| HTTPS certificate checks, no "continue anyway" | Yes (with a bypass) | Yes, stricter: no bypass |
| HTTPS first (try `https` before `http`) | Yes | Yes, built by us |
| Permission prompts (camera, microphone, location, notifications) | Yes | Yes, built by us, remembered per site |
| Downloads never open by themselves | Yes | Yes |
| Clear browsing data | Yes | Yes (in Settings) |
| Cookies encrypted on disk | Yes | Yes (Electron fuse `enableCookieEncryption`) |
| App cannot be started as a plain Node program | n/a | Yes (Electron fuses) |
| Security fixes | Automatic, within days | **Weaker.** Fixes arrive when the app is rebuilt on a new Electron. The app checks and tells you when a newer Electron exists. |
| Google Safe Browsing (warns about phishing and malware sites) | Yes | **No.** It is a Google service that is not part of Electron. |
| Password leak check, Enhanced Protection | Yes | **No.** Google account services. |
| Extension checks by the Chrome Web Store | Yes | **Partly.** Extension support in Electron is limited. |
| Signed and notarised app | Yes | **No** in version 1. Needs a paid Apple and Windows signing identity. |

**Rule:** for banking and other high-value sites, use "send to browser" and do it in Dia or Chrome. Instant Browser is for quick lookups and short forms.

On the first start of the built app, macOS may ask once for Keychain access for "Instant Browser Safe Storage". That is expected. It protects the saved cookies.

## Notes

Electron must be kept on the latest stable version. That is how Chromium security fixes arrive.

## Licence

Instant Browser is open source under the **Apache License 2.0** (see [LICENSE](LICENSE)). You may use, change and share it, including in products you sell, as long as you keep the licence and notices. The licence includes a patent grant. The name "Instant Browser" and its icon are not part of the licence (see [NOTICE](NOTICE)). Third-party parts are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
