# Agents (MCP) in Instant Browser for Windows

Instant Browser has a built-in MCP server, so agents that run on your PC (Claude Code, Codex, Antigravity, any MCP client)
can use the browser with your own subscription. Nothing leaves the computer: the server listens on `127.0.0.1` only.
This is **parts 1 and 2** (part 2 in version 14 of the Windows package). It is a port of the Mac server, adapted to what the Windows code has.
It has not been tried on a real Windows PC yet (see the README).

## How it is built

- **Off by default.** Settings > Agents > "Let agents on this computer use Instant Browser" (`mcpEnabled`).
- **Transport:** MCP Streamable HTTP, JSON responses only, at `http://127.0.0.1:<port>/mcp` (`mcpPort`, default 47821).
  `GET /mcp` answers 405. Protocol version `2025-06-18` (older client versions are accepted).
- **One key per agent:** every request needs `Authorization: Bearer <key>`. Each agent added in Settings > Agents has its
  own key (32 random bytes, hex), kept with its id and name in `<userData>/mcp-agents.json` (at most 20 agents). The file
  is written with mode 0600; on Windows that mode does nothing (the file is protected by your user profile instead), but the
  call is kept. Settings can make a new key for one agent (locking out only that agent) or remove an agent.
- **Browser pages cannot call it:** a request with an `Origin` header is refused (403), and the `Host` must be
  `127.0.0.1:<port>` or `localhost:<port>` (stops DNS rebinding).
- **Never shared:** passwords, cookies, sign-ins, keys, and the agent keys themselves (Settings never receives a key; copying
  a setup happens in the main process).
- **Server name in the setup text:** `instant-browser`. Claude Code: `claude mcp add --transport http instant-browser http://127.0.0.1:47821/mcp --header "Authorization: Bearer <key>"`
  (Settings > Agents > Copy Claude Code setup, Copy Codex setup, Copy JSON).
- Code: `src/shared/mcp/` (protocol, setup text; pure and unit tested), `src/main/mcp/` (HTTP server, keys, activity log,
  tools wired to the stores), `src/main/agentBookmarkStore.ts`, `src/main/downloadLog.ts`.

## Tools on Windows

| Tool | What it does | Changes data |
|---|---|---|
| `list_history` | Pages from the history (Instant Browser and other browsers), newest first. Optional `query`, `limit`, `since` / `before` (ISO times), `source` (browser name; the time limits then use that browser's last visit) and `offset`. Returns `total`, `nextOffset` (null at the end) and `lastVisitBySource` for each page. Only each page's last visit per browser is kept, not every visit | no |
| `list_pins` | Pins and archived pins (id, title, address, state) | no |
| `list_windows` | Open small windows: id, title, address, `focused`, `bounds` (x, y, width, height), `openedByYou`, `openedByAgent` (never names which agent), `canClose` (same as `openedByYou`). Ownership is kept in memory and is lost when the app restarts | no |
| `list_site_permissions` | Permissions saved for sites: origin, permission, allow or deny | no |
| `list_downloads` | Recent downloads since the app started, newest first (address without query, file name, save path, state, bytes) | no |
| `list_agent_folders`, `list_agent_folder` | Agent folders from every agent and the pages in one | no |
| `create_bookmark_folder` | Make an agent folder; the agent sets `allowDelete` once | agent data only |
| `add_bookmark` | Add a page to an agent folder (owner only): one `url` and `title`, or up to 50 `items` `[{ url, title? }]`, saved in one write, with one result per item (`added`, `exists`, `error`); one bad item does not stop the rest | agent data only |
| `remove_bookmark` | Remove a page from an agent folder that allows it (owner only) | agent data only |
| `delete_bookmark_folder` | Delete an agent folder that allows it (owner only) | agent data only |
| `open_window` | Open a page in a new small window; returns its `id`. One `url` or up to 5 `urls`; `focus` false opens it behind; `reuseIfOpen` returns a window that already shows the address (`reused: true`, no budget spent; one the agent did not open stays closed to it). Each window that opens costs one of the 5 per minute per agent, so a batch cannot get around the limit | opens a window |
| `close_window` | Close a window this agent opened | closes its own window |
| `focus_window` | Bring an open window to the front | no |
| `navigate_window` | Load an http/https address in an open window (shares the 5 per minute limit) | changes a window |
| `go_back`, `go_forward`, `reload_window` | Back, forward, reload in an open window | changes a window |
| `pin_action` | Open or offload a pin | no deletion |
| `pin_window` | Turn an open window into a pin, like its Collapse button | makes a pin |
| `rename_pin` | Set a pin's name (0..60 characters) | renames |
| `archive_pin`, `unarchive_pin` | Move a pin to the Archive and back | reversible |

| `get_settings` | Read the settings that are not secret, which keys `set_setting` may change, and `capabilities`, which groups of tools are on (`read`, `folders`, `windows`, `pins`, `pages`, `settings`, `actions`; read only) | no |
| `read_page` | Visible text, numbered links and numbered `elements` of a window or pin (`windowId` or `pinId`) | no |
| `screenshot` | PNG of a window or pin, at most 1600 pixels wide | no |
| `set_setting` | Change one `safe` setting (see below); the change can be undone in Settings | changes a setting |
| `click`, `type`, `scroll` | Act in a page, by `index` (from `read_page`) or CSS `selector` | acts in a page |

Groups: `read` (always allowed while agents are on, includes `get_settings`), `folders`, `windows`, `pins`, `pages`, `settings`, `act`.
Settings > Agents has a switch for each of the last six: `mcpAllowFolders`, `mcpAllowWindows`, `mcpAllowPins` (on by default),
**Read pages** `mcpAllowPages`, **Change settings** `mcpAllowSettings`, **Act in pages (click and type)** `mcpAllowActions` (off by default). A tool whose group is off is left out of
`tools/list`, and a call to it returns an error result. Agents can never delete a pin: there is no delete tool and the pin tools
get no delete function.

### Mac-only for now (not registered on Windows at all)

- `list_bookmarks`, `list_browser_bookmarks`: Windows has no store of your own bookmarks and no reader for other browsers' bookmarks.
- `list_browser_tabs`: Windows has no listing of the tabs of other browsers.
- Anything that needs sync (there is none on Windows).
- **"Move to my bookmarks"** in Manage (needs your own bookmark store). Manage lists agent folders, shows their pages, and lets you open or remove a page, remove a folder, and lock or allow deletion.
- Not yet on either platform: the full pin manager set-up.

## Agent folders

Agent folders live in `<userData>/agent-bookmarks.json`, apart from anything of yours. Only a folder's owner can add to it.
The owner can remove pages or delete the folder only while `allowDelete` is on; the agent chooses it once, when it makes the folder,
and after that only you can change it (Settings > Agents, Lock or Allow deletion; or Manage). Any agent can read any agent folder.
Agent identity comes from the key, not from anything the agent says: a folder's owner is the agent's id. An agent folder is never claimed by name, because any agent can be given any name.

## Reading pages

`read_page` returns `{ title, url, untrustedPageText, links, elements, truncated }`: the visible text (`innerText`, read in an isolated world, so
input values and passwords are never included), up to 200 http/https links, and up to 200 numbered visible links, buttons, fields and editable
elements (`index`, `tag`, `type`, `label` of 80 characters at most, never a value). A pin works only while its page is live: an offloaded pin
returns "Open it first with pin_action". Windows: a window is found with `miniWindow.pageOf`, a pin with `pinManager.pageOf`. The text is
untrusted web content: the tool descriptions say so. Reads are not logged.

**Secrets are hidden.** Agents can read everything except passwords and API keys. `read_page` and `screenshot` hide likely secrets that a page shows as plain text: well-known key formats (Anthropic, OpenAI, GitHub, GitLab, Slack, AWS, Google, Stripe, JWT, private key blocks, Bearer tokens), values after labels such as "API key:", "token=" or "password:", and secret-looking address parameters (`token`, `key`, `sig`, `code` and similar) and `user:password@`. In text they become `[hidden secret]` and `read_page` adds `hiddenSecrets` (how many). In a screenshot those words, password fields and fields holding a secret are painted black before the picture is resized, and the result has `hiddenAreas`. Secret values are never logged or returned. Limits: secrets inside images, canvas or video, text split over several elements, and secrets with no known format or label cannot be found.

## Settings

`src/shared/mcp/settingsPolicy.ts` puts every Windows setting in one class (`SETTING_ACCESS`; a setting that is not classed does not compile):

- **safe** (read and change): `alwaysOnTop`, `windowSize`, `defaultZoom`, `updateNotice`, `showSuggestions`,
  `showHistory`, `historyOff`, `warmWindow`, `pinSize`, `pinArmMs`, `maxPins`, `autoOffloadInactivity`, `autoOffloadMinutes`, `autoOffloadMemory`,
  `autoOffloadMemoryGB`, `memoryAsk`. `showHistory` and `historyOff` can only be changed to read less of your other browsers
  (switch reading off, add a browser to the off list); turning reading back on is for you in Settings.
- **read** (read only): `searchTemplate` (an agent could otherwise send every search to a site it picks), `hotkey`, `launchAtLogin`, `linkRouter`, `linkRouterKeys`, `terminalLinksSmallWindow` (part of the link router),
  `mainBrowserId`, `diaProfile`, `diaProfiles`, `httpsFirst`, `sendGpc`, `askDownloadLocation`, `downloadFolder`. Anything that can break typing or
  where links go, and anything about privacy or files, is never changed by an agent.
- **hidden**: every `mcp*` key.

Windows has no sync, bookmark-reading or open-tab settings, so those Mac keys do not exist here. `set_setting` checks the value with `mergeSettings`
(the saved value must equal what was asked) and runs the same side effects as the Settings window through `applySettingsChange`
(`src/main/applySettings.ts`: hotkey, warm window, history, login item, agent server). Each call is logged with an undo (key and old value);
Settings > Agents > Recent activity has an **Undo** button, used once.

## Acting in pages

`click`, `type` and `scroll` name one of `windowId` or `pinId`, and one of `index` or `selector`. The first time an agent acts on a site, a native
dialog asks "<agent> wants to click and type on <origin>": **Allow once**, **Always allow for this site**, **Don't allow** (default). Only http and
https pages. "Always allow" is saved per agent and site in `<userData>/agent-site-approvals.json` and listed in Settings > Agents, "Sites agents may
act on", with Remove. `type` refuses password, card (`cc-*`) and one-time-code fields and anything not editable. Typed text is never logged (only
`<12 chars>`). At most 60 act calls per minute per agent. `click` sends a real mouse press at the element centre; the point is in CSS pixels and is
multiplied by the page zoom for `sendInputEvent`. Windows display scaling is handled by Electron and is not applied again. Elements are marked
`data-instant-idx` in the isolated world.

## Activity

Every call to a tool that changes something (`changes: true`), allowed or refused, is written to `<userData>/agent-activity.jsonl`
(time, agent, tool, short arguments, ok, message). The newest 2000 lines are kept. `type` logs only the length of the text. Reading is never logged. Settings > Agents shows
the last 20 changes and has a Clear button.

## Security rules (checked by tests)

- Agents never change your own data. `tests/unit/mcpNoUserWrites.test.ts` checks that no MCP file imports the stores that hold your
  history or pins, that the read tools get list functions only, and that no pin delete exists.
- The server accepts only `127.0.0.1`, refuses requests with an `Origin`, and checks the `Host` (`tests/unit/mcpServer.test.ts`).
