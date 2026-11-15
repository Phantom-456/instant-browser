# Instant Browser

Instant Browser is a small background app for Mac (Windows later). You press a hotkey, type a search, and a small one-tab browser window opens on top of the app you are working in. You can close it, or send the page to any browser you have installed.

## Install

Download it from the project page: **https://phantom-456.github.io/instant-browser/** (Mac and Windows). The files are in GitHub Releases. The app updates itself.

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

## Build the Mac app

```bash
pnpm dist:mac
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
- **Offload** (below): drag the small bubble toward the pin. The page is saved as a picture and released from memory. The pin becomes a border only. Click the pin and the window grows back with the saved picture, then the live page loads and the scroll position comes back. A click on the Offload bubble pauses its countdown, a right-click goes on.
- **Remove** (above) takes the pin away and keeps it in an archive.
- Click the name to rename it (up to 60 characters). Drag the pin to move it.
- Pins come back after a restart as border-only pins.
- **Automatic Offload** is off until you turn it on in Settings > Pins: by time without use, or when the app uses more memory than a limit you choose (the oldest pins go first; paused pins stay).

**Memory, honestly:** every pin is its own small window and costs about 80 MB, even after Offload. Offload frees the page behind the pin, which is often 90 to 200 MB. The most pins at once is 12 by default (4 to 40 in Settings). The menu bar icon has a Pins list with Open, Offload and Remove for each pin.

## Pin Manager

Open it from the menu bar icon (Pin Manager), from the round bubble to the right of the search bar, or with Cmd+Shift+P while the search bar is open. It lists:

- **Pins**: name, address, colours, and whether the page is in memory or released. Open, Rename (double-click the name), Offload, Follow, Details and Remove.
- **Open windows**: Show or Close. An open window is not a pin.
- **Archive**: pins you removed. **Put back** shows the pin again (released). **Delete for good** asks first and cannot be undone.

macOS does not tell apps the names or numbers of your desktops, so pins are listed in one place. A pin whose desktop is gone is still listed and opens from here.

The round **Settings** bubble beside the search bar opens a menu of settings sections when you hover it (Cmd+, does the same from the keyboard).

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

- **Ready window:** the app keeps one hidden window ready, so the next small window opens at once. It uses about 180 MB of memory while it waits, and it is let go after 10 minutes without use. Turn it off in Settings > General > "Keep a window ready".
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
