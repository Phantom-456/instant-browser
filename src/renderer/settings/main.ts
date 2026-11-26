import { formatAccelerator } from '../../shared/accelerator'
import type { HotkeyEvent, SettingsAction, SettingsView } from '../../shared/ipc'
import { SETTINGS_SECTIONS } from '../../shared/bubbles'
import { DIA_ID } from '../../shared/dia'
import { LINK_KEY_PRESETS } from '../../shared/linkRouter'
import { canSkip, updateLabel } from '../../shared/updateLabel'
import { PIN_SIZES, type Settings } from '../../shared/settings'
import { STRENGTH_TEXT, checkPassphrase, generatePassphrase, strengthOf } from '../../shared/sync/passphrase'
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
  Pins: 'collapse',
  Sync: 'reload',
  Agents: 'manager',
  'Your browsers': 'globe',
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

/** A heading for a group of options on a page. The page draws one card for each group. */
function head(title: string, about = ''): HTMLElement {
  const h = node('div', { className: 'group-head' }, node('h2', {}, title))
  if (about) h.append(node('p', {}, about))
  return h
}

function toggle(key: keyof Settings): HTMLInputElement {
  const box = node('input', { type: 'checkbox', checked: Boolean(view.settings[key]) })
  box.onchange = () => void save({ [key]: box.checked } as Partial<Settings>)
  box.dataset.focusKey = `toggle:${key}`
  return box
}

/** A switch for one browser. The settings list holds the browsers that are left out. */
function sourceSwitch(name: string, key: 'historyOff' | 'bookmarksOff' | 'liveTabsOff' = 'historyOff'): HTMLInputElement {
  const box = node('input', { type: 'checkbox', checked: !view.settings[key].includes(name) })
  box.onchange = () => {
    const off = view.settings[key].filter((n) => n !== name)
    void save({ [key]: box.checked ? off : [...off, name] } as Partial<Settings>)
  }
  return box
}

function tabStateText(state: 'ok' | 'not-running' | 'denied' | 'error' | undefined): string {
  switch (state) {
    case 'ok': return 'Allowed. Its tabs are listed.'
    case 'not-running': return 'Not open right now.'
    case 'denied': return 'macOS has not allowed this. Open System Settings, Privacy & Security, Automation, and allow Talaria to control this browser.'
    case 'error': return 'Could not read its tabs.'
    default: return 'Waiting for the answer...'
  }
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

/** The buttons at the end of a row. They stay beside the text when there is room and drop under it when there is not. */
function actions(...children: Node[]): HTMLElement { return node('div', { className: 'row-actions' }, ...children) }

/** A name box and an Add button. Enter adds; Add stays off while the box is empty or there are 20 agents. */
function addAgentForm(count: number): HTMLFormElement {
  const name = node('input', { type: 'text', placeholder: 'Agent name', maxLength: 40 })
  name.setAttribute('aria-label', 'New agent name')
  const add = button('Add', () => {})
  add.type = 'submit'
  const sync = () => { add.disabled = !name.value.trim() || count >= 20 }
  name.oninput = sync
  sync()
  const form = node('form', { className: 'inline-form' }, name, add)
  form.onsubmit = (e) => { e.preventDefault(); const v = name.value.trim(); if (v && count < 20) void act({ type: 'mcp-agent-add', name: v }) }
  return form
}

/** Say something to screen readers (a visually hidden live region). */
function announce(text: string): void {
  let live = document.getElementById('sr-live')
  if (!live) { live = node('div', { id: 'sr-live' }); live.setAttribute('role', 'status'); document.body.append(live) }
  live.textContent = text
}

/** A line of grey text in a card when a list is empty. Not a row: no control, no hover. */
function emptyRow(text: string): HTMLElement { return node('div', { className: 'row empty' }, node('div', { className: 'hint' }, text)) }

/** A button that removes or clears something: drawn in red. */
function danger(b: HTMLButtonElement): HTMLButtonElement { b.classList.add('danger'); return b }

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = node('button', { className: 'act', textContent: label })
  b.onclick = onClick
  return b
}

/**
 * The passphrase that locks the synced data (end-to-end encryption). A row with a button; the button opens a small window with steps:
 * choose it (or let the app make one), this computer (Touch ID), save it. On another computer it is one step: enter it.
 */
function passphraseRow(create: boolean): HTMLElement {
  return row(
    create ? 'Lock your synced data' : 'Unlock your synced data',
    create
      ? 'Your pins, bookmarks and the rest are locked with a passphrase before they leave this computer, so Google only holds scrambled data. You choose it once, in a few steps.'
      : 'Your synced data was locked with a passphrase on another computer. Enter that passphrase once here. This computer then keeps the key and does not ask again.',
    button(create ? 'Choose a passphrase...' : 'Unlock...', () => openPassphraseWindow(create))
  )
}

function ago(time: number | null): string {
  return time ? new Date(time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet'
}

/** What protects the synced data right now, and what is and is not synced. Read only; the changes are in the rows near it. */
function securityRows(sync: SettingsView['sync']): HTMLElement[] {
  const s = sync.security!
  const c = sync.counts
  const line = (label: string, value: string) => node('div', { className: 'fact' }, node('span', { className: 'fact-label' }, label), node('span', { className: 'fact-value' }, value))
  const counts = (name: string, n: { synced: number; local: number }) => `${name}: ${n.synced} synced, ${n.local} only on this computer`
  return [
    row('Encryption', s.active ? 'On. The data is locked on this computer before it leaves.' : 'The key is not on this computer yet. Nothing is sent until you unlock.',
      node('div', { className: 'facts' },
        line('Lock', `${s.cipher}, key from your passphrase with ${s.kdf}`),
        line('Key set on this computer', ago(s.keySetAt)),
        line('Passphrase rating when chosen', s.rating ? s.rating : 'not known here (chosen on another computer)'),
        line('Key is kept in', s.keyStorage === 'keychain' ? 'the system keychain' : 'a private file (only you can read it)'),
        line('Recovery key', s.recovery ? 'Made. Keep it safe: it opens your data if you lose the passphrase.' : 'Not made yet. Without it, a lost passphrase means the synced data cannot be opened.'),
        line('Last sync', ago(sync.lastSyncAt)),
        node('div', { className: 'actions' },
          ...(s.active ? [button('Change passphrase...', openChangeWindow), button(s.recovery ? 'Make a new recovery key...' : 'Make a recovery key...', () => { if (window.confirm('The recovery key is shown once. Have a pen or your password manager ready. Continue?')) void act({ type: 'sync-make-recovery' }) })] : []),
          button('Remove key from this computer', () => void act({ type: 'sync-forget-key' }))))),
    row('Your other computers', sync.computers.length === 0 ? 'No other computer is sharing what it has open. (Only computers with "share what I have open" turned on are listed.)' : 'Computers that share what they have open, and when they last synced.',
      node('div', { className: 'facts' },
        ...sync.computers.map((d) => line(d.name, `last synced ${ago(d.updatedAt)}`)),
        node('div', { className: 'hint' }, 'To lock a computer out, change the passphrase: that computer then cannot open the data until it gets the new one.'))),
    row('Synced and not synced', 'Items that are in the shared file, and items that stay only on this computer (the switch is off, not sent yet, or marked to stay here).',
      node('div', { className: 'facts' }, line('Pins', counts('Pins', c.pins).slice(6)), line('Bookmarks', counts('Bookmarks', c.bookmarks).slice(11)), line('History', counts('History', c.history).slice(9))))
  ]
}

/** Unlock with the recovery key (the spare way in when the passphrase is lost). */
function openRecoveryEntry(): void {
  document.querySelector('.modal-backdrop')?.remove()
  const backdrop = node('div', { className: 'modal-backdrop' })
  const dialog = node('div', { className: 'modal', role: 'dialog' })
  dialog.setAttribute('aria-modal', 'true')
  const note = node('div', { className: 'hint warn' })
  const input = node('input', { type: 'text', name: 'sync-recovery', autocomplete: 'off', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' })
  input.setAttribute('aria-label', 'Recovery key')
  input.spellcheck = false
  const close = () => backdrop.remove()
  const go = button('Unlock', async () => {
    if (!input.value.trim()) { note.textContent = 'Type the recovery key first.'; return }
    const typed = input.value
    close()
    await act({ type: 'sync-unlock-recovery', key: typed })
  })
  go.classList.add('primary')
  dialog.append(
    node('h2', {}, 'Unlock with the recovery key'),
    node('p', { className: 'lead' }, 'Type the recovery key you saved. Capitals, spaces and dashes do not matter.'),
    node('form', { className: 'modal-form' }, input), note,
    node('div', { className: 'modal-buttons' }, button('Cancel', close), go)
  )
  backdrop.append(dialog)
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close() })
  document.body.append(backdrop)
  queueMicrotask(() => input.focus())
}

/** Change the passphrase: the current one, then the new one twice. The main side checks it again and refuses a weak one. */
function openChangeWindow(): void {
  document.querySelector('.modal-backdrop')?.remove()
  const backdrop = node('div', { className: 'modal-backdrop' })
  const dialog = node('div', { className: 'modal', role: 'dialog' })
  dialog.setAttribute('aria-modal', 'true')
  const note = node('div', { className: 'hint warn' })
  const mk = (name: string, label: string, ac: string): HTMLInputElement => {
    const i = node('input', { type: 'password', name, autocomplete: ac })
    i.setAttribute('aria-label', label)
    i.placeholder = label
    return i
  }
  const current = mk('sync-current', 'Current passphrase', 'current-password')
  const next = mk('sync-passphrase', 'New passphrase', 'new-password')
  const again = mk('sync-passphrase-again', 'Type the new one again', 'new-password')
  const close = () => backdrop.remove()
  const save = button('Change passphrase', async () => {
    if (!current.value) { note.textContent = 'Type the current passphrase.'; return }
    if (next.value !== again.value) { note.textContent = 'The two new passphrases are not the same.'; return }
    const verdict = checkPassphrase(next.value)
    if (!verdict.ok) { note.textContent = verdict.reason; return }
    if (!window.confirm('Your other computers will ask for the new passphrase once. Change it now?')) return
    close()
    await act({ type: 'sync-change-passphrase', current: current.value, passphrase: next.value })
  })
  save.classList.add('primary')
  dialog.append(
    node('h2', {}, 'Change the passphrase'),
    node('p', { className: 'lead' }, 'Your synced data is locked again with the new passphrase. Your other computers will ask for it once. Save it in your password manager.'),
    node('form', { className: 'modal-form' }, node('input', { type: 'text', name: 'username', autocomplete: 'username', value: 'Talaria sync', tabIndex: -1, className: 'visually-hidden' }), current, next, again),
    note,
    node('div', { className: 'modal-buttons' }, button('Cancel', close), save)
  )
  backdrop.append(dialog)
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close() })
  document.body.append(backdrop)
  queueMicrotask(() => current.focus())
}

function randomBytes(count: number): Uint8Array { return crypto.getRandomValues(new Uint8Array(count)) }

function openPassphraseWindow(create: boolean): void {
  document.querySelector('.modal-backdrop')?.remove()
  const touch = view.touchIdAvailable
  const steps = create ? (touch ? ['choose', 'computer', 'save'] : ['choose', 'save']) : ['unlock']
  let at = 0
  let passphrase = ''
  let useTouchId = view.settings.syncTouchId
  let revealed = false

  const backdrop = node('div', { className: 'modal-backdrop' })
  const dialog = node('div', { className: 'modal', role: 'dialog' })
  dialog.setAttribute('aria-modal', 'true')
  backdrop.append(dialog)
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close() })

  const render = () => {
    const step = steps[at]!
    dialog.replaceChildren()
    const title = node('h2', { id: 'modal-title' })
    dialog.setAttribute('aria-labelledby', 'modal-title')
    const body = node('div', { className: 'modal-body' })
    const note = node('div', { className: 'hint warn' })
    const back = button(at === 0 ? 'Cancel' : 'Back', () => { if (at === 0) close(); else { at--; render() } })
    const next = button('Next', () => {})
    next.classList.add('primary')
    let focusTarget: HTMLInputElement | null = null

    if (steps.length > 1) dialog.append(node('div', { className: 'steps' }, `Step ${at + 1} of ${steps.length}`))
    dialog.append(title, body, note, node('div', { className: 'modal-buttons' }, back, next))

    // A real form with a (hidden) account name, so a password manager knows what the passphrase belongs to.
    const field = (id: string, label: string, auto: string, value = '') => {
      const input = node('input', { type: revealed ? 'text' : 'password', id, name: id, value, autocomplete: auto })
      input.setAttribute('aria-label', label)
      input.placeholder = label
      return input
    }
    const account = node('input', { type: 'text', name: 'username', autocomplete: 'username', value: 'Talaria sync', tabIndex: -1 })
    account.setAttribute('aria-hidden', 'true')
    account.className = 'visually-hidden'

    if (step === 'choose') {
      title.textContent = 'Choose a passphrase'
      const first = field('sync-passphrase', 'Passphrase', 'new-password', passphrase)
      const again = field('sync-passphrase-again', 'Type it again', 'new-password', passphrase)
      const meter = node('div', { className: 'meter' })
      const show = node('button', { type: 'button', className: 'linkish', textContent: revealed ? 'Hide' : 'Show' })
      const gen = node('button', { type: 'button', className: 'linkish', textContent: 'Make a strong one for me' })
      const update = () => {
        passphrase = first.value
        const level = strengthOf(first.value)
        meter.dataset.level = level
        meter.textContent = first.value ? STRENGTH_TEXT[level] : ''
        note.textContent = ''
      }
      first.addEventListener('input', update)
      show.onclick = () => { revealed = !revealed; passphrase = first.value; render() }
      gen.onclick = () => { passphrase = generatePassphrase(randomBytes); revealed = true; render() }
      const form = node('form', { className: 'modal-form' }, account, first, again, meter, node('div', { className: 'modal-links' }, gen, show))
      form.addEventListener('submit', (e) => { e.preventDefault(); next.click() })
      body.append(node('p', { className: 'lead' }, 'This passphrase locks your synced data. Only your computers will know it. You type it once on each other computer. It is never sent to Google or to us.'), form)
      update()
      next.onclick = () => {
        if (first.value !== again.value) { note.textContent = 'The two passphrases are not the same.'; return }
        const verdict = checkPassphrase(first.value)
        if (!verdict.ok) { note.textContent = verdict.reason; return }
        passphrase = first.value
        at++
        render()
      }
      focusTarget = first
    } else if (step === 'computer') {
      title.textContent = 'This computer'
      const box = node('input', { type: 'checkbox', checked: useTouchId, id: 'touch' })
      box.onchange = () => { useTouchId = box.checked }
      body.append(
        node('p', { className: 'lead' }, 'This computer keeps the key safely, so it does not ask for the passphrase again, also after updates.'),
        node('label', { className: 'check', htmlFor: 'touch' }, box, node('span', {}, 'Ask for Touch ID before this computer syncs. Once each time the app starts.'))
      )
      next.onclick = () => { at++; render() }
    } else if (step === 'save') {
      title.textContent = 'Keep it safe'
      const sure = node('input', { type: 'checkbox', id: 'saved' })
      const copy = node('button', { type: 'button', className: 'linkish', textContent: 'Copy the passphrase' })
      copy.onclick = () => { void navigator.clipboard.writeText(passphrase).then(() => { copy.textContent = 'Copied. Paste it into your password manager.' }) }
      body.append(
        node('p', { className: 'lead' }, 'If you forget this passphrase and have no other computer that is already unlocked, nobody can get your synced data back, not even us. Save it now in a password manager (1Password, Bitwarden, the Passwords app) or write it down.'),
        node('div', { className: 'modal-links' }, copy),
        node('label', { className: 'check', htmlFor: 'saved' }, sure, node('span', {}, 'I saved my passphrase somewhere safe.'))
      )
      next.textContent = 'Lock and start syncing'
      next.onclick = async () => {
        if (!sure.checked) { note.textContent = 'Please save it first, then tick the box.'; return }
        next.disabled = true
        view = await api.update({ syncTouchId: touch ? useTouchId : false })
        const chosen = passphrase
        passphrase = ''
        close()
        await act({ type: 'sync-set-passphrase', passphrase: chosen })
      }
    } else {
      title.textContent = 'Unlock your synced data'
      const first = field('sync-passphrase', 'Passphrase', 'current-password')
      const show = node('button', { type: 'button', className: 'linkish', textContent: revealed ? 'Hide' : 'Show' })
      show.onclick = () => { revealed = !revealed; render() }
      const useRecovery = node('button', { type: 'button', className: 'linkish', textContent: 'Lost the passphrase? Use the recovery key' })
      useRecovery.onclick = () => { close(); openRecoveryEntry() }
      const form = node('form', { className: 'modal-form' }, account, first, node('div', { className: 'modal-links' }, show, useRecovery))
      form.addEventListener('submit', (e) => { e.preventDefault(); next.click() })
      body.append(node('p', { className: 'lead' }, 'Enter the passphrase you chose on your other computer. This computer then keeps the key and does not ask again.'), form)
      next.textContent = 'Unlock'
      next.onclick = async () => {
        if (first.value.length < 1) { note.textContent = 'Type the passphrase first.'; return }
        const typed = first.value
        close()
        await act({ type: 'sync-unlock', passphrase: typed })
      }
      focusTarget = first
    }
    document.body.append(backdrop)
    queueMicrotask(() => focusTarget?.focus())
  }
  render()
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
      : 'Open Dia once with Talaria running to load its profiles. macOS may ask you to allow Talaria to control Dia.'
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

/** After "Make default", macOS asks the user. Look again a few times, so the page shows the answer. */
function refreshSoon(): void {
  for (const ms of [1500, 4000, 9000]) setTimeout(() => void api.get().then((fresh) => { view = fresh; render() }), ms)
}

function updateButtons(): HTMLElement {
  const buttons = node('div', { className: 'hotkey' })
  buttons.append(view.update.status === 'ready'
    ? button('Restart to update', () => void act({ type: 'install-update' }))
    : button('Check for updates', () => void act({ type: 'check-updates' })))
  if (canSkip(view.update)) buttons.append(button('Skip this version', () => void act({ type: 'skip-update' })))
  buttons.append(button('What\'s new', () => void act({ type: 'open-release-notes' })))
  buttons.append(button('Report a problem', () => void act({ type: 'report-problem' })))
  return buttons
}

function defaultBrowserRow(): HTMLElement {
  const note = view.defaultBrowser
  const buttons = node('div', { className: 'hotkey' })
  if (note.canMakeDefault) buttons.append(button('Make default', () => { void act({ type: 'make-default-browser' }); refreshSoon() }))
  buttons.append(button('Open system settings', () => void act({ type: 'open-default-browser-settings' })))
  const line = row('Default browser', note.text, buttons)
  // Only the warning is red; the explanation stays normal.
  if (note.warning) line.querySelector('.text')?.append(node('div', { className: 'hint warn' }, note.warning))
  return line
}

function sectionRows(section: Section): HTMLElement[] {
  const s = view.settings
  switch (section) {
    case 'General':
      return [
        head('Shortcut', 'The key that opens the search bar.'),
        hotkeyRow(),
        ...(view.platform === 'darwin'
          ? [row(
              'Also let the app in front use the hotkey',
              view.settings.hotkeyShare && !view.hotkeyShared
                ? 'Not working yet: allow Talaria in System Settings > Privacy & Security > Accessibility, then turn this off and on. Until then the normal hotkey is used.'
                : 'Opens the search bar even when another app uses the same key, and that app still gets the key too (click away if you do not need the bar). Needs the Accessibility permission; macOS asks when you turn this on. Only key presses that match the hotkey are looked at, and nothing is saved or sent.',
              toggle('hotkeyShare'),
              view.settings.hotkeyShare && !view.hotkeyShared
            )]
          : []),
        head('Startup'),
        row('Start when I log in', '', toggle('launchAtLogin')),
        row('Keep a window ready', 'Opens the next small window at once. It keeps a hidden window waiting, which uses about 40 MB of memory. It is let go after 10 minutes without use.', toggle('warmWindow')),
        head('Your main browser', 'Where pages go when you send them out of Talaria.'),
        row('Main browser', 'Where "send to browser" opens pages.',
          select(view.browsers.map((b) => ({ label: b.name, value: b.id })), s.mainBrowserId ?? view.browsers[0]?.id ?? '', (mainBrowserId) => void save({ mainBrowserId }))),
        ...(view.browsers.some((b) => b.id === DIA_ID) ? [diaProfileRow()] : []),
        defaultBrowserRow(),
        head('Links from other apps', 'What happens when you click a link in another app.'),
        row('Link router',
          view.isDefaultBrowser
            ? 'Active. Links you click in other apps go to your main browser. Hold the keys below while you click to open the link in a small window instead.'
            : 'Not active yet. It works only while Talaria is your default browser. Links open in a small window until then.',
          toggle('linkRouter')),
        row('Keys for a small window', 'Hold these keys while you click a link in another app.',
          select(LINK_KEY_PRESETS.map((p) => ({ label: p.label, value: p.id })), s.linkRouterKeys, (linkRouterKeys) => void save({ linkRouterKeys }))),
        row('Links from terminals and code editors', 'They open in a small window, with no keys needed. It covers Terminal, iTerm, Warp, Ghostty, VS Code and similar apps, and suits sign-in pages from commands such as "gh auth login". Passkeys and security keys may not work in the small window.', toggle('terminalLinksSmallWindow'))
      ]
    case 'Search engine': {
      const known = view.engines.some((e) => e.template === s.searchTemplate)
      return [
        head('Engine', 'The site that answers your searches.'),
        row('Search engine used in the search bar', '',
          select([...view.engines.map((e) => ({ label: e.name, value: e.template })), { label: 'Custom', value: 'custom' }],
            known ? s.searchTemplate : 'custom',
            (value) => { if (value !== 'custom') void save({ searchTemplate: value }) })),
        head('Suggestions'),
        row('Show suggestions while I type', 'Sends what you type to your search engine (Google, DuckDuckGo or Bing) so it can suggest searches. Turn this off to send nothing until you press Enter.', toggle('showSuggestions')),
        row('Custom search address', 'Must contain %s where the search words go.',
          textBox(s.searchTemplate, (searchTemplate) => void save({ searchTemplate })))
      ]
    }
    case 'Appearance':
      return [
        head('New windows', 'The size and place of a small window when it opens.'),
        row('New window width', 'In pixels, 320 to 2000.', numberBox(s.windowSize.width, 320, 2000, 10, (width) => void save({ windowSize: { ...s.windowSize, width } }))),
        row('New window height', 'In pixels, 240 to 2000.', numberBox(s.windowSize.height, 240, 2000, 10, (height) => void save({ windowSize: { ...s.windowSize, height } }))),
        row('Keep new windows on top', 'Windows stay above other apps until you collapse them to a pin. Pins always float.', toggle('alwaysOnTop')),
        head('Pages'),
        row('Page zoom', '1 is normal size. 0.5 to 3.', numberBox(s.defaultZoom, 0.5, 3, 0.1, (defaultZoom) => void save({ defaultZoom })))
      ]
    case 'Pins': {
      // The size on offer that is closest to the saved one.
      const nearest = PIN_SIZES.reduce((a, b) => (Math.abs(b.value - s.pinSize) < Math.abs(a.value - s.pinSize) ? b : a))
      return [
        head('Look and feel', 'How a pin looks and when it takes clicks.'),
        row('Pin size', 'How big a pin is on the desktop. Default is the size of the pin button in the toolbar.',
          select(PIN_SIZES.map((p) => ({ label: p.label, value: String(p.value) })), String(nearest.value), (value) => void save({ pinSize: Number(value) }))),
        head('Limits'),
        row('Most pins at once', '4 to 40. A pin whose page is alive has a small window of its own, about 20 MB (macOS memory figure). A pin whose page is released has no page process and uses almost nothing, until you point at it.',
          numberBox(s.maxPins, 4, 40, 1, (maxPins) => void save({ maxPins }))),
        row('Wait before a pin takes clicks (seconds)', 'How long the pointer must rest on a pin before it opens and takes clicks. Until then clicks go through to the app behind it. 0 means at once. You can use decimals, down to a thousandth: 1.1, 1.25, 0.5. Up to 30.',
          numberBox(s.pinArmMs / 1000, 0, 30, 0.1, (seconds) => void save({ pinArmMs: Math.round(seconds * 1000) }))),
        head('Offload pins I have not used', 'Release the memory of a pin that sits unused.'),
        row('Offload pins I have not used', 'Offload releases the memory of a collapsed page. The pin stays and the page loads again when you open it. A ring on the Offload bubble shows the time left. Click that bubble to pause it (the page then stays in memory). Right-click to go on.',
          toggle('autoOffloadInactivity')),
        row('Minutes without use', '5 to 240. Starts when you collapse a window, and starts again when you open it.',
          numberBox(s.autoOffloadMinutes, 5, 240, 5, (autoOffloadMinutes) => void save({ autoOffloadMinutes }))),
        head('Offload when memory is high', 'Release the oldest pins when Talaria uses too much memory.'),
        row('Offload when memory is high', 'When Talaria uses more memory than the limit, the oldest pins are offloaded first, until it uses about 80 percent of the limit. Pins with a paused countdown, pins that play sound and pages with a download are skipped. Offload frees the page, but the pin windows and the app itself still use memory.',
          toggle('autoOffloadMemory')),
        row('Memory limit (GB)', '0.5 to 8. The memory of the whole app, all its windows and pages together.',
          numberBox(s.autoOffloadMemoryGB, 0.5, 8, 0.5, (autoOffloadMemoryGB) => void save({ autoOffloadMemoryGB }))),
        row('Ask before offloading', 'When memory is over the limit, show a small notice that asks whether to offload some pins. Turn this off to offload without asking.',
          toggle('memoryAsk'))
      ]
    }
    case 'Sync': {
      const sync = view.sync
      const connected = sync.state !== 'off' && sync.state !== 'connecting' && !(sync.state === 'error' && !sync.lastSyncAt)
      const busy = sync.state === 'connecting' || sync.state === 'syncing'
      return [
        head('Google Drive', 'The connection, and whether it works now.'),
        row('Google Drive', sync.available
          ? 'Keeps your pins and a few settings the same on your computers. It uses one hidden folder in your own Google Drive that only this app can see. It cannot see the rest of your Drive.'
          : sync.message,
          sync.state === 'needs-passphrase' || sync.state === 'locked'
            ? node('span', {})
            : connected
            ? node('div', { className: 'actions' }, button('Sync now', () => void act({ type: 'sync-now' })))
            : button(sync.state === 'connecting' ? 'Waiting for you...' : 'Connect Google Drive', () => void act({ type: 'sync-connect' }))),
        row('Status', sync.message, node('span', {}, busy ? 'Working...' : ''), sync.state === 'error' || sync.state === 'offline'),
        ...(sync.state === 'needs-passphrase' ? [passphraseRow(true)] : []),
        ...(sync.state === 'locked' ? [passphraseRow(false)] : []),
        ...(sync.security ? [head('Encryption and recovery', 'Your files are locked with your passphrase before they leave this computer.'), ...securityRows(sync)] : []),
        head('What to sync', 'Each kind of data has its own switch. These belong to this computer.'),
        row('Sync my bookmarks', 'One list of bookmarks for your whole Google account: the same page is one bookmark on every computer, and removing it removes it everywhere.', toggle('syncBookmarks')),
        row('Sync my history', 'The addresses you opened from this app (not the history of your other browsers), with how often and when. Cleared history stays cleared on every computer.', toggle('syncHistory')),
        row('Sites left out of history sync', 'The history of these sites stays on this computer only. Write the site names with commas, for example bank.example.com, mail.example.com. A name also covers its subdomains.', textBox(view.settings.syncHistoryExcluded.join(', '), (text) => void save({ syncHistoryExcluded: text.split(/[\s,]+/).filter(Boolean) }))),
        row('Share what I have open', 'Your other computers can see the pages you have open here (windows and pins), and open them there with "Open here" in Manage. The list updates when you open or close a window, and every few minutes.', toggle('syncOpenPages')),
        row('This computer\'s name', 'Shown on your other computers next to the pages open here. Up to 40 characters.', textBox(view.settings.deviceName, (deviceName) => void save({ deviceName }))),
        head('What is synced and what is not'),
        row('What is synced', 'Your pins (address, title, your name for it, archived or not), a short list of settings, and what the switches above allow. The colours of pins are the same on every computer. Everything is locked with your passphrase before it leaves this computer.', node('span', {})),
        row('What is never synced', 'Passwords, cookies, logged-in sessions, site data, the saved pictures of released pages, where windows and pins sit on your screen, and the history of your other browsers.', node('span', {})),
        ...(connected
          ? [
              head('Disconnect'),
              row('Disconnect', 'This computer stops syncing. Your pins and settings here stay, and the synced file in Drive stays for your other computers.', button('Disconnect', () => void act({ type: 'sync-disconnect' }))),
              row('Disconnect and delete synced data', 'Also deletes the synced file from your Google Drive. Other computers keep their own copies.', button('Delete and disconnect', () => void act({ type: 'sync-disconnect-delete' })))
            ]
          : [])
      ]
    }
    case 'Agents': {
      const m = view.mcp
      const status = m.state === 'on' ? `Running at ${m.url}`
        : m.state === 'in-use' ? 'The port is used by another app. Choose another port.'
        : m.state === 'error' ? 'The agent server could not start.'
        : 'Off.'
      return [
        head('Agents on this Mac', 'Let AI agents that run on this Mac (Claude Code, Codex, Antigravity and others) read your bookmarks, history, pins and windows. They use your own subscription. Passwords, sign-ins and keys are never shared.'),
        row('Let agents on this Mac use Talaria', status, toggle('mcpEnabled'), m.state === 'in-use' || m.state === 'error'),
        row('Port', 'The server listens on this computer only. 1024 to 65535.', numberBox(s.mcpPort, 1024, 65535, 1, (mcpPort) => void save({ mcpPort }))),
        head('Agents', 'Each agent has its own key, so agents cannot act as each other. Copy the setup text and use it in that agent. It holds the key, so keep it private.'),
        ...(m.agents.length ? [] : [emptyRow('No agents yet. Add one below to get its setup text.')]),
        ...m.agents.map((a) => {
          const menuAt = (btn: HTMLElement, menu: 'copy' | 'more') => { const r = btn.getBoundingClientRect(); void act({ type: 'mcp-agent-menu', agentId: a.id, menu, x: Math.round(r.left), y: Math.round(r.bottom + 4) }) }
          const copyBtn = button('Copy setup ▾', () => menuAt(copyBtn, 'copy'))
          copyBtn.dataset.focusKey = `agent:${a.id}:copy`
          copyBtn.setAttribute('aria-haspopup', 'menu')
          const more = button('⋯', () => menuAt(more, 'more'))
          more.dataset.focusKey = `agent:${a.id}:more`
          more.classList.add('icon')
          more.setAttribute('aria-label', `More actions for ${a.name}`)
          more.setAttribute('aria-haspopup', 'menu')
          const copied = m.copied?.agentId === a.id ? m.copied.label : ''
          const r = row(a.name, copied || `Added ${new Date(a.createdAt).toLocaleDateString()}`, actions(copyBtn, more))
          if (copied) { r.querySelector('.hint')?.classList.add('copied'); announce(copied) }
          return r
        }),
        row('Add agent', m.agents.length >= 20 ? 'You have 20 agents, the most allowed.' : 'Up to 20 agents.', addAgentForm(m.agents.length)),
        head('Agent folders', 'Bookmark folders that agents made. You can remove any of them.'),
        ...(m.folders.length
          ? m.folders.map((f) => row(f.name, `By ${f.owner} · ${f.count} pages · deletion by the agent ${f.allowDelete ? 'allowed' : 'not allowed'}`,
              actions(
                button(f.allowDelete ? 'Lock' : 'Allow deletion', () => void act({ type: 'mcp-folder-permission', folderId: f.id, allowDelete: !f.allowDelete })),
                danger(button('Remove', () => void act({ type: 'mcp-remove-folder', folderId: f.id }))))))
          : [emptyRow('No folders yet. Agents make them when they save pages.')]),
        head('What agents may do', 'Reading is always allowed while agents are on. Passwords, sign-ins and keys are never shared.'),
        row('Agent folders', 'Make folders and save pages.', toggle('mcpAllowFolders')),
        row('Open windows', 'Open a page for you, bring a window to the front.', toggle('mcpAllowWindows')),
        row('Pins', 'Open or offload pins.', toggle('mcpAllowPins')),
        row('Change settings', 'Let agents change look and behaviour settings such as pin size, zoom and the search engine. Privacy, security, sync, the hotkey and agent settings can never be changed by an agent.', toggle('mcpAllowSettings')),
        row('Read pages', 'Let agents read the text of pages open in Talaria windows and pins, and take screenshots. Form fields and passwords are never read.', toggle('mcpAllowPages')),
        row('Act in pages (click and type)', 'Let agents click, type and scroll in pages open in Talaria windows and pins. Talaria asks you the first time an agent acts on each site. Password, card and one-time-code fields are never typed into.', toggle('mcpAllowActions')),
        head('Sites agents may act on', 'Sites you chose "Always allow" for.'),
        ...(m.approvals.length
          ? m.approvals.map((a) => row(a.origin, `Allowed for ${a.agentName}`, actions(danger(button('Remove', () => void act({ type: 'mcp-approval-remove', agentId: a.agentId, origin: a.origin }))))))
          : [emptyRow('No sites yet. A site shows here after you choose "Always allow".')]),
        head('Recent activity', 'Changes agents made, newest first. Reading is not listed.'),
        ...(m.activity.length
          ? m.activity.slice(0, 20).map((a) => row(`${a.agent}: ${a.tool}`, `${new Date(a.time).toLocaleString()} · ${a.args}${a.ok ? '' : ' · refused: ' + a.message}`, actions(...(a.undo ? [button('Undo', () => void act({ type: 'mcp-undo', time: a.time }))] : []))))
          : [emptyRow('Nothing yet. Changes agents make show here.')]),
        ...(m.activity.length ? [row('Clear the list', '', actions(danger(button('Clear', () => void act({ type: 'mcp-clear-activity' })))))] : [])
      ]
    }
    case 'Your browsers': {
      return [
        head('Bookmarks from your browsers', 'One list of the bookmarks in every browser on this computer. The same address is one entry, in the folders the browsers already use. It is read only: Talaria never changes a browser.'),
        row('Show bookmarks from my other browsers', 'Reads the bookmark files of your browsers. They show in Manage and in the search bar. Cookies and passwords are never read.', toggle('otherBookmarks')),
        ...(s.otherBookmarks ? view.bookmarkSources.map((name) => row(`Bookmarks from ${name}`, '', sourceSwitch(name, 'bookmarksOff'))) : []),
        row('Keep a copy', 'Saves the merged list in Talaria\'s own folder, so it is there at once when Talaria starts, even when a browser is closed or its file is locked.', toggle('keepCopy')),
        head('History from your browsers', 'The pages you opened in the other browsers, mixed into the search bar and Manage. It stays in memory and is read only.'),
        row('Show history in the search bar', 'Reads the history files of your browsers on this computer to suggest your recent searches and pages. History stays in memory. Nothing is copied or sent anywhere. Cookies and passwords are never read.', toggle('showHistory')),
        ...(s.showHistory ? view.historySources.map((name) => row(`History from ${name}`, '', sourceSwitch(name))) : []),
        head('Open tabs', view.tabsAvailable ? 'The tabs that are open now in your browsers, with the time Talaria first saw each one.' : 'Listing open tabs works on a Mac only.'),
        ...(view.tabsAvailable
          ? [
              row('List open tabs', 'macOS asks you to allow Talaria to control each browser, once for each. Until you turn this on, Talaria asks for nothing. It is off by default because an update can make macOS ask again. Only the address and title of each tab are read. A closed browser is never started.', toggle('liveTabs')),
              ...(s.liveTabs
                ? ['Google Chrome', 'Microsoft Edge', 'Brave', 'Arc', 'Vivaldi', 'Safari'].map((name) =>
                    row(`Tabs from ${name}`, tabStateText(view.tabBrowsers.find((t) => t.name === name)?.state), sourceSwitch(name, 'liveTabsOff')))
                : [])
            ]
          : []),
        head('Keeping up to date'),
        row('Watch the browsers\' files', 'When a browser changes its bookmarks or history, Talaria reads the file again a few seconds later. It only looks at the files, with a light watch. Turn this off to update only when the search bar opens and every few minutes.', toggle('watchBrowsers'))
      ]
    }
    case 'Privacy and security':
      return [
        head('Connections', 'How Talaria talks to websites.'),
        row('Always use secure connections', 'Try https first. Ask before opening a site that only has http.', toggle('httpsFirst')),
        row('Ask sites not to sell or share my data', 'Sends the Global Privacy Control signal.', toggle('sendGpc')),
        head('Updates'),
        row('Update automatically', 'Looks on GitHub for a newer version of Talaria every few hours and downloads it in the background. It sends only a normal web request. New versions also bring the latest browser engine security fixes.', toggle('updateNotice')),
        head('Clear data', 'Remove what Talaria keeps. Your other browsers are not changed.'),
        row('Clear what Talaria remembers', 'The searches and pages you opened from the search bar. Your browsers are not changed.', button('Clear', () => void act({ type: 'clear-own-history' }))),
        row('Clear browsing data', 'Cookies, site data and cache of Talaria only.', button('Clear data', () => void act({ type: 'clear-data' })))
      ]
    case 'Site permissions':
      return view.permissions.length
        ? [head('Saved choices', 'What you allowed or denied for each site.'), ...view.permissions.map((p) =>
            row(p.origin, `${p.permission}: ${p.decision === 'allow' ? 'allowed' : 'denied'}`,
              button('Remove', () => void act({ type: 'remove-permission', origin: p.origin, permission: p.permission }))))]
        : [head('Saved choices'), row('No saved choices', 'Sites ask before they use the camera, microphone, location, notifications or the clipboard.', node('span'))]
    case 'Downloads':
      return [
        head('Saving files'),
        row('Ask where to save each file', '', toggle('askDownloadLocation')),
        row('Download folder', s.downloadFolder ?? 'Your Downloads folder', button('Change', () => void act({ type: 'choose-download-folder' })))
      ]
    case 'About':
      return [
        head('Talaria (QuickPeek)', 'Your version, and updates.'),
        row('Talaria (QuickPeek)', updateLabel(view.update), updateButtons()),
        ...(s.skippedVersions.length
          ? [row('Skipped versions', `${s.skippedVersions.join(', ')}. These are never downloaded or installed.`,
              button('Allow again', () => void act({ type: 'unskip-updates' })))]
          : []),
        head('Engine and security'),
        row('Browser engine', `Chromium ${view.about.chromium} (Electron ${view.about.electron})`, node('span')),
        row('Security', 'Same Chromium sandbox as Chrome. No Google Safe Browsing and no automatic updates. Use your main browser for banking. See the README.', node('span'))
      ]
  }
}

function render(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey
  nav.replaceChildren(
    ...SECTIONS.map((name) => {
      const b = node('button', { className: name === current ? 'on' : '' })
      const icon = node('span', { className: 'ico' })
      icon.innerHTML = ICONS[SECTION_ICONS[name]] ?? ''
      b.append(icon, name)
      b.dataset.focusKey = `nav:${name}`
      b.onclick = () => { current = name; render() }
      return b
    })
  )
  // Each page is a parent with groups. A group is a heading and the options under it, in a card of its own.
  const page = node('div', { id: 'section' }, node('h1', {}, current))
  let card: HTMLElement | null = null
  for (const el of sectionRows(current)) {
    if (el.classList.contains('group-head')) { page.append(el); card = null; continue }
    if (!card) { card = node('div', { className: 'card' }); page.append(card) }
    card.append(el)
  }
  // The top strip (for dragging the window) and the scrolling page are separate, so nothing scrolls under the strip,
  // and the scroll position stays when the page is redrawn.
  let scroller = main.querySelector<HTMLElement>('.main-scroll')
  if (!scroller) { scroller = node('div', { className: 'main-scroll' }); main.replaceChildren(node('div', { className: 'titlebar-drag' }), scroller) }
  scroller.replaceChildren(page)
  // Controls without their own key get one from their place on the page, so focus can come back after a redraw.
  let n = 0
  for (const el of scroller.querySelectorAll<HTMLElement>('button, input, select')) { if (!el.dataset.focusKey) el.dataset.focusKey = `${current}#${n}`; n++ }
  if (focusKey) {
    const again = [...document.querySelectorAll<HTMLElement>('[data-focus-key]')].find((el) => el.dataset.focusKey === focusKey)
    again?.focus({ preventScroll: true })
  }
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

// While Drive sync is waiting for the browser or working, keep the Sync page up to date.
setInterval(() => {
  if (current === 'Sync' && (view?.sync.state === 'connecting' || view?.sync.state === 'syncing')) {
    void api.get().then((fresh) => { view = fresh; render() })
  }
}, 1200)

// While the open-tabs answers come in (macOS may be asking for permission), keep the page up to date.
setInterval(() => {
  if (current === 'Your browsers' && view?.settings.liveTabs && document.hasFocus()) {
    void api.get().then((fresh) => {
      // Draw again only when an answer changed, so a click is never lost to a redraw.
      if (JSON.stringify(fresh.tabBrowsers) !== JSON.stringify(view.tabBrowsers)) { view = fresh; render() }
    })
  }
}, 2500)

// While an update is being checked or downloaded, keep the About page up to date.
setInterval(() => {
  if (current === 'About' && (view?.update.status === 'checking' || view?.update.status === 'downloading')) {
    void api.get().then((fresh) => { view = fresh; render() })
  }
}, 1500)

void api.get().then((first) => { view = first; render() })
