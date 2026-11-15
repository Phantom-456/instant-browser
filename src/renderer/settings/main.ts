import { formatAccelerator } from '../../shared/accelerator'
import type { HotkeyEvent, SettingsAction, SettingsView } from '../../shared/ipc'
import { SETTINGS_SECTIONS } from '../../shared/bubbles'
import { DIA_ID } from '../../shared/dia'
import { LINK_KEY_PRESETS } from '../../shared/linkRouter'
import { updateLabel } from '../../shared/updateLabel'
import type { Settings } from '../../shared/settings'
import { ICONS } from '../shared/icons'

interface Api {
  get(): Promise<SettingsView>
  update(patch: Partial<Settings>): Promise<SettingsView>
  action(action: SettingsAction): Promise<SettingsView>
  onHotkeyEvent(callback: (event: HotkeyEvent) => void): void
  onSection(callback: (section: string) => void): void
}
const api = (window as unknown as { instantSettings: Api }).instantSettings
const nav = document.getElementById('nav') as HTMLElement
const main = document.getElementById('main') as HTMLElement

const SECTIONS = SETTINGS_SECTIONS
type Section = (typeof SECTIONS)[number]
const SECTION_ICONS: Record<Section, string> = {
  General: 'general',
  'Search engine': 'search',
  Appearance: 'appearance',
  'Privacy and security': 'privacy',
  'Site permissions': 'permissions',
  Downloads: 'downloads',
  About: 'about'
}
const fromHash = SECTIONS.find((n) => n === decodeURIComponent(location.hash.slice(1)))
let current: Section = fromHash ?? 'General'
let view: SettingsView
let recording = false // the page is waiting for the new hotkey
let recordingHint = '' // keys held so far, or a message about the last try
let recordingFailed = false

const save = async (patch: Partial<Settings>) => { view = await api.update(patch); render() }
const act = async (action: SettingsAction) => { view = await api.action(action); render() }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  Object.assign(element, props)
  element.append(...children)
  return element
}

function row(title: string, hint: string, control: Node, warn = false): HTMLElement {
  const text = node('div', { className: 'text' }, node('div', {}, title))
  if (hint) text.append(node('div', { className: warn ? 'hint warn' : 'hint' }, hint))
  return node('div', { className: 'row' }, text, control)
}

function toggle(key: keyof Settings): HTMLInputElement {
  const box = node('input', { type: 'checkbox', checked: Boolean(view.settings[key]) })
  box.onchange = () => void save({ [key]: box.checked } as Partial<Settings>)
  return box
}

function sourceSwitch(name: string): HTMLInputElement {
  const box = node('input', { type: 'checkbox', checked: !view.settings.historyOff.includes(name) })
  box.onchange = () => {
    const off = view.settings.historyOff.filter((n) => n !== name)
    void save({ historyOff: box.checked ? off : [...off, name] })
  }
  return box
}

function textBox(value: string, onCommit: (value: string) => void): HTMLInputElement {
  const box = node('input', { type: 'text', value })
  box.onchange = () => onCommit(box.value.trim())
  return box
}

function numberBox(value: number, min: number, max: number, step: number, onCommit: (value: number) => void): HTMLInputElement {
  const box = node('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) })
  box.onchange = () => { if (box.value !== '') onCommit(Number(box.value)) }
  return box
}

function select(options: Array<{ label: string; value: string }>, value: string, onCommit: (value: string) => void): HTMLSelectElement {
  const box = node('select')
  for (const o of options) box.append(node('option', { value: o.value, textContent: o.label, selected: o.value === value }))
  box.onchange = () => onCommit(box.value)
  return box
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = node('button', { className: 'act', textContent: label })
  b.onclick = onClick
  return b
}

function diaProfileRow(): HTMLElement {
  const names = view.diaProfiles
  const chosen = view.settings.diaProfile
  // A profile that was chosen earlier stays in the list, even if Dia does not show it now.
  const all = chosen && !names.includes(chosen) ? [chosen, ...names] : names
  const hint = view.diaProfilesLive
    ? 'The Dia profile (space of tabs) that "send to browser" opens pages in.'
    : names.length
      ? 'Dia is not running, so this is the list from last time. Open Dia to refresh it.'
      : 'Open Dia once with Instant Browser running to load its profiles. macOS may ask you to allow Instant Browser to control Dia.'
  return row('Dia profile', hint,
    select([{ label: "Dia's current profile", value: '' }, ...all.map((n) => ({ label: n, value: n }))], chosen ?? '',
      (name) => void save({ diaProfile: name || null })))
}

function hotkeyRow(): HTMLElement {
  const shown = formatAccelerator(view.settings.hotkey, view.platform as NodeJS.Platform)
  const control = node('div', { className: 'hotkey' })
  if (recording) {
    control.append(
      node('span', { className: 'keys recording' }, recordingHint && !recordingFailed ? `${recordingHint}…` : 'Press the new keys…'),
      button('Cancel', () => {
        recording = false
        recordingHint = ''
        void act({ type: 'hotkey-record-cancel' })
      })
    )
    return row(
      'Hotkey',
      recordingFailed && recordingHint ? recordingHint : 'Press the keys you want, for example Command+Option+B. Press Esc to cancel.',
      control,
      recordingFailed
    )
  }
  control.append(
    node('span', { className: 'keys' }, shown),
    button('Change', () => {
      recording = true
      recordingHint = ''
      recordingFailed = false
      void act({ type: 'hotkey-record-start' })
    })
  )
  return row(
    'Hotkey',
    view.hotkeyOk ? 'Opens the search bar from any app. It is saved on this computer only and is not synced.' : 'This key is used by another app or is not valid. Click Change to choose another one.',
    control,
    !view.hotkeyOk
  )
}

function sectionRows(section: Section): HTMLElement[] {
  const s = view.settings
  switch (section) {
    case 'General':
      return [
        hotkeyRow(),
        row('Start when I log in', '', toggle('launchAtLogin')),
        row('Keep a window ready', 'Opens the next small window at once. It keeps a hidden window waiting, which uses about 180 MB of memory. It is let go after 10 minutes without use.', toggle('warmWindow')),
        row('Main browser', 'Where "send to browser" opens pages.',
          select(view.browsers.map((b) => ({ label: b.name, value: b.id })), s.mainBrowserId ?? view.browsers[0]?.id ?? '', (mainBrowserId) => void save({ mainBrowserId }))),
        ...(view.browsers.some((b) => b.id === DIA_ID) ? [diaProfileRow()] : []),
        row('Default browser', 'Links you click in other apps open in a small window. You choose this in the system settings.',
          button('Open system settings', () => void act({ type: 'open-default-browser-settings' }))),
        row('Link router',
          view.isDefaultBrowser
            ? 'Active. Links you click in other apps go to your main browser. Hold the keys below while you click to open the link in a small window instead.'
            : 'Not active yet. It works only while Instant Browser is your default browser. Links open in a small window until then.',
          toggle('linkRouter')),
        row('Keys for a small window', 'Hold these keys while you click a link in another app.',
          select(LINK_KEY_PRESETS.map((p) => ({ label: p.label, value: p.id })), s.linkRouterKeys, (linkRouterKeys) => void save({ linkRouterKeys })))
      ]
    case 'Search engine': {
      const known = view.engines.some((e) => e.template === s.searchTemplate)
      return [
        row('Search engine used in the search bar', '',
          select([...view.engines.map((e) => ({ label: e.name, value: e.template })), { label: 'Custom', value: 'custom' }],
            known ? s.searchTemplate : 'custom',
            (value) => { if (value !== 'custom') void save({ searchTemplate: value }) })),
        row('Show suggestions while I type', 'Sends what you type to your search engine (Google, DuckDuckGo or Bing) so it can suggest searches. Turn this off to send nothing until you press Enter.', toggle('showSuggestions')),
        row('Custom search address', 'Must contain %s where the search words go.',
          textBox(s.searchTemplate, (searchTemplate) => void save({ searchTemplate })))
      ]
    }
    case 'Appearance':
      return [
        row('New window width', 'In pixels, 320 to 2000.', numberBox(s.windowSize.width, 320, 2000, 10, (width) => void save({ windowSize: { ...s.windowSize, width } }))),
        row('New window height', 'In pixels, 240 to 2000.', numberBox(s.windowSize.height, 240, 2000, 10, (height) => void save({ windowSize: { ...s.windowSize, height } }))),
        row('Keep new windows on top', 'Each window also has its own pin button.', toggle('alwaysOnTop')),
        row('Page zoom', '1 is normal size. 0.5 to 3.', numberBox(s.defaultZoom, 0.5, 3, 0.1, (defaultZoom) => void save({ defaultZoom })))
      ]
    case 'Privacy and security':
      return [
        row('Always use secure connections', 'Try https first. Ask before opening a site that only has http.', toggle('httpsFirst')),
        row('Ask sites not to sell or share my data', 'Sends the Global Privacy Control signal.', toggle('sendGpc')),
        row('Update automatically', 'Looks on GitHub for a newer version of Instant Browser every few hours and downloads it in the background. It sends only a normal web request. New versions also bring the latest browser engine security fixes.', toggle('updateNotice')),
        row('Show history in the search bar', 'Reads the history files of your browsers on this computer to suggest your recent searches and pages. History stays in memory. Nothing is copied or sent anywhere. Cookies and passwords are never read.', toggle('showHistory')),
        ...view.historySources.map((name) =>
          row(`History from ${name}`, '', sourceSwitch(name))),
        row('Clear what Instant Browser remembers', 'The searches and pages you opened from the search bar. Your browsers are not changed.', button('Clear', () => void act({ type: 'clear-own-history' }))),
        row('Clear browsing data', 'Cookies, site data and cache of Instant Browser only.', button('Clear data', () => void act({ type: 'clear-data' })))
      ]
    case 'Site permissions':
      return view.permissions.length
        ? view.permissions.map((p) =>
            row(p.origin, `${p.permission}: ${p.decision === 'allow' ? 'allowed' : 'denied'}`,
              button('Remove', () => void act({ type: 'remove-permission', origin: p.origin, permission: p.permission }))))
        : [row('No saved choices', 'Sites ask before they use the camera, microphone, location, notifications or the clipboard.', node('span'))]
    case 'Downloads':
      return [
        row('Ask where to save each file', '', toggle('askDownloadLocation')),
        row('Download folder', s.downloadFolder ?? 'Your Downloads folder', button('Change', () => void act({ type: 'choose-download-folder' })))
      ]
    case 'About':
      return [
        row('Instant Browser', updateLabel(view.update),
          view.update.status === 'ready'
            ? button('Restart to update', () => void act({ type: 'install-update' }))
            : button('Check for updates', () => void act({ type: 'check-updates' }))),
        row('Browser engine', `Chromium ${view.about.chromium} (Electron ${view.about.electron})`, node('span')),
        row('Security', 'Same Chromium sandbox as Chrome. No Google Safe Browsing and no automatic updates. Use your main browser for banking. See the README.', node('span'))
      ]
  }
}

function render(): void {
  nav.replaceChildren(
    ...SECTIONS.map((name) => {
      const b = node('button', { className: name === current ? 'on' : '' })
      const icon = node('span', { className: 'ico' })
      icon.innerHTML = ICONS[SECTION_ICONS[name]] ?? ''
      b.append(icon, name)
      b.onclick = () => { current = name; render() }
      return b
    })
  )
  main.replaceChildren(node('div', { id: 'section' }, node('h1', {}, current), node('div', { className: 'card' }, ...sectionRows(current))))
}

api.onHotkeyEvent((event) => {
  if (event.status === 'pending' || event.status === 'invalid') {
    recordingHint = event.text
    recordingFailed = event.status === 'invalid'
    render()
    return
  }
  recording = false
  recordingHint = ''
  recordingFailed = false
  void api.get().then((fresh) => { view = fresh; render() })
})

api.onSection((name) => {
  const found = SECTIONS.find((n) => n === name)
  if (found) { current = found; render() }
})

// While an update is being checked or downloaded, keep the About page up to date.
setInterval(() => {
  if (current === 'About' && (view?.update.status === 'checking' || view?.update.status === 'downloading')) {
    void api.get().then((fresh) => { view = fresh; render() })
  }
}, 1500)

void api.get().then((first) => { view = first; render() })
